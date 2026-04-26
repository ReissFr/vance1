// SmartThingsProvider — SmartHomeProvider implementation backed by Samsung's
// SmartThings REST API (https://developer.smartthings.com/docs/api/public/).
//
// Auth: personal access token (PAT) with scopes r:devices:*, x:devices:* for
// read + command. Stored in integrations.credentials.token.
//
// Note on Samsung TV power-on: the TV will only wake via SmartThings if it
// supports "Power On with Mobile" (Settings → General → Network → Expert
// Settings → Power On with Mobile). Without it, SmartThings can turn the TV
// off but not on — a hardware limitation we can't work around in software.

import type {
  SmartHomeProvider,
  HomeDevice,
  HomeDeviceType,
  HomeCommand,
  CommandResult,
} from "./provider";

const API_BASE = "https://api.smartthings.com/v1";

export type SmartThingsCredentials = {
  token?: string | null;
};

export type SmartThingsProviderOptions = {
  credentials: SmartThingsCredentials;
};

type STDevice = {
  deviceId: string;
  label: string | null;
  name: string | null;
  roomId: string | null;
  deviceTypeName?: string | null;
  components?: Array<{
    id: string;
    capabilities: Array<{ id: string }>;
  }>;
};

type STRoom = { roomId: string; name: string };

export class SmartThingsProvider implements SmartHomeProvider {
  readonly providerName = "smartthings";

  private readonly token: string;

  constructor(opts: SmartThingsProviderOptions) {
    const token = opts.credentials.token;
    if (!token) {
      throw new Error("SmartThings integration missing credentials.token");
    }
    this.token = token;
  }

  async listDevices(): Promise<HomeDevice[]> {
    const [devicesRes, roomsRes] = await Promise.all([
      this.req("/devices"),
      this.req("/locations").then(async (locs) => {
        const items = (locs.items ?? []) as Array<{ locationId: string }>;
        const allRooms: STRoom[] = [];
        for (const loc of items) {
          const r = await this.req(`/locations/${loc.locationId}/rooms`);
          for (const rm of (r.items ?? []) as STRoom[]) allRooms.push(rm);
        }
        return allRooms;
      }),
    ]);

    const roomNameById = new Map<string, string>();
    for (const r of roomsRes) roomNameById.set(r.roomId, r.name);

    const items = (devicesRes.items ?? []) as STDevice[];
    const out: HomeDevice[] = [];
    for (const d of items) {
      const capabilities = collectCapabilities(d);
      const type = inferType(d, capabilities);
      let state: Record<string, unknown> = {};
      let online = true;
      try {
        const status = await this.req(`/devices/${d.deviceId}/status`);
        state = extractState(status);
        const health = await this.req(`/devices/${d.deviceId}/health`);
        online = (health as { state?: string }).state !== "OFFLINE";
      } catch {
        // status/health may fail per-device; don't kill the whole listing.
      }
      out.push({
        id: d.deviceId,
        name: d.label ?? d.name ?? d.deviceId,
        type,
        room: d.roomId ? roomNameById.get(d.roomId) ?? null : null,
        capabilities: normalizeCapabilities(capabilities),
        state,
        online,
      });
    }
    return out;
  }

  async executeCommand(deviceId: string, command: HomeCommand): Promise<CommandResult> {
    const cmds = mapCommand(command);
    if (!cmds) {
      return { ok: false, message: `Unsupported command: ${command.kind}` };
    }
    try {
      await this.req(`/devices/${deviceId}/commands`, {
        method: "POST",
        body: JSON.stringify({ commands: cmds }),
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SmartThings ${init.method ?? "GET"} ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }
}

function collectCapabilities(d: STDevice): string[] {
  const out = new Set<string>();
  for (const comp of d.components ?? []) {
    for (const cap of comp.capabilities ?? []) out.add(cap.id);
  }
  return [...out];
}

function inferType(d: STDevice, caps: string[]): HomeDeviceType {
  const name = (d.deviceTypeName ?? d.name ?? d.label ?? "").toLowerCase();
  if (name.includes("tv") || caps.includes("tvChannel") || caps.includes("samsungvd.mediaInputSource")) return "tv";
  if (name.includes("speaker") || name.includes("soundbar") || name.includes("audio")) return "speaker";
  if (caps.includes("switchLevel") || caps.includes("colorControl") || caps.includes("colorTemperature")) return "light";
  if (caps.includes("thermostatMode")) return "thermostat";
  if (caps.includes("temperatureMeasurement") || caps.includes("motionSensor") || caps.includes("contactSensor")) return "sensor";
  if (caps.includes("switch")) return "plug";
  return "other";
}

// Map SmartThings capability IDs to generic tags the brain reasons about.
function normalizeCapabilities(caps: string[]): string[] {
  const out = new Set<string>();
  for (const c of caps) {
    if (c === "switch") out.add("power");
    else if (c === "audioVolume") {
      out.add("volume");
      out.add("mute");
    }
    else if (c === "audioMute") out.add("mute");
    else if (c === "mediaInputSource" || c === "samsungvd.mediaInputSource") out.add("input");
    else if (c === "tvChannel") out.add("channel");
    else if (c === "mediaPlayback") out.add("playback");
    else if (c === "switchLevel") out.add("brightness");
    else if (c === "colorTemperature") out.add("color_temperature");
    else if (c === "colorControl") out.add("color");
  }
  return [...out];
}

function extractState(status: any): Record<string, unknown> {
  const main = status?.components?.main;
  if (!main) return {};
  const state: Record<string, unknown> = {};
  const sw = main.switch?.switch?.value;
  if (sw) state.power = sw;
  const vol = main.audioVolume?.volume?.value;
  if (typeof vol === "number") state.volume = vol;
  const mute = main.audioMute?.mute?.value;
  if (mute) state.muted = mute === "muted";
  const input = main.mediaInputSource?.inputSource?.value
    ?? main["samsungvd.mediaInputSource"]?.inputSource?.value;
  if (input) state.input = input;
  const playback = main.mediaPlayback?.playbackStatus?.value;
  if (playback) state.playback = playback;
  const level = main.switchLevel?.level?.value;
  if (typeof level === "number") state.brightness = level;
  return state;
}

type STCommand = {
  component: string;
  capability: string;
  command: string;
  arguments?: unknown[];
};

function mapCommand(cmd: HomeCommand): STCommand[] | null {
  const component = "main";
  switch (cmd.kind) {
    case "power":
      return [
        {
          component,
          capability: "switch",
          command: cmd.value === "toggle" ? "toggle" : cmd.value,
        },
      ];
    case "volume":
      return [{ component, capability: "audioVolume", command: "setVolume", arguments: [cmd.value] }];
    case "volume_step":
      return [{ component, capability: "audioVolume", command: cmd.value === "up" ? "volumeUp" : "volumeDown" }];
    case "mute":
      if (cmd.value === "toggle") return [{ component, capability: "audioMute", command: "setMute", arguments: ["muted"] }];
      return [{ component, capability: "audioMute", command: "setMute", arguments: [cmd.value === "mute" ? "muted" : "unmuted"] }];
    case "input":
      return [{ component, capability: "mediaInputSource", command: "setInputSource", arguments: [cmd.value] }];
    case "channel_step":
      return [{ component, capability: "tvChannel", command: cmd.value === "up" ? "channelUp" : "channelDown" }];
    case "playback":
      return [{ component, capability: "mediaPlayback", command: cmd.value }];
    case "brightness":
      return [{ component, capability: "switchLevel", command: "setLevel", arguments: [cmd.value] }];
    case "color_temperature":
      return [{ component, capability: "colorTemperature", command: "setColorTemperature", arguments: [cmd.value] }];
    default:
      return null;
  }
}
