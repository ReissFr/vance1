// SmartHomeProvider — capability interface for any smart-home backend.
//
// First implementation is Samsung SmartThings (covers Samsung TVs, soundbars,
// fridges, washers, and anything onboarded to a SmartThings account). The
// interface must be implementable on Google Home, Apple HomeKit (via Homebridge
// or Matter), and Home Assistant with no interface changes.
//
// Scope for the first cut is intentionally narrow: list devices, turn on/off,
// volume, input, play/pause. Scenes/routines/thermostat control come later.

export type HomeDeviceType =
  | "tv"
  | "speaker"
  | "light"
  | "plug"
  | "switch"
  | "thermostat"
  | "sensor"
  | "appliance"
  | "other";

// Normalized device shape — providers map their native models onto this.
export type HomeDevice = {
  id: string;
  name: string;
  type: HomeDeviceType;
  room: string | null;
  // Free-form capability tags the brain can reason about: "power", "volume",
  // "input", "playback", "channel", "brightness", "color", "temperature".
  capabilities: string[];
  // Current state, provider-specific but normalized where possible.
  // Common fields: { power: "on"|"off", volume: number, muted: boolean,
  // input: string, brightness: number, temperature_c: number }
  state: Record<string, unknown>;
  online: boolean;
};

export type HomeCommand =
  | { kind: "power"; value: "on" | "off" | "toggle" }
  | { kind: "volume"; value: number } // 0-100 absolute
  | { kind: "volume_step"; value: "up" | "down" }
  | { kind: "mute"; value: "mute" | "unmute" | "toggle" }
  | { kind: "input"; value: string } // e.g. "HDMI1", "TV", "digitalTv"
  | { kind: "channel_step"; value: "up" | "down" }
  | { kind: "playback"; value: "play" | "pause" | "stop" }
  | { kind: "brightness"; value: number } // 0-100
  | { kind: "color_temperature"; value: number }; // kelvin

export type CommandResult = {
  ok: boolean;
  message?: string;
};

export interface SmartHomeProvider {
  readonly providerName: string;

  listDevices(): Promise<HomeDevice[]>;

  // Execute a normalized command against a device. Providers map it to their
  // native API. Throw on auth failures; return {ok:false,message} for logical
  // failures (device offline, unsupported command).
  executeCommand(deviceId: string, command: HomeCommand): Promise<CommandResult>;
}
