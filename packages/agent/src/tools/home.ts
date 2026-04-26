// Brain-level smart-home tools. Back a SmartHomeProvider (SmartThings today;
// Google Home / HomeKit / Home Assistant pluggable) behind the
// @jarvis/integrations resolver. Read + control. No destructive ops — worst
// case is the user's TV turns off, recoverable with one tap.

import { z } from "zod";
import { getSmartHomeProvider, type HomeCommand } from "@jarvis/integrations";
import { defineTool } from "./types";

export const homeListDevicesTool = defineTool({
  name: "home_list_devices",
  description:
    "List connected smart-home devices (TVs, speakers, lights, plugs, etc.) with their current state and supported capabilities. Call this first to resolve a spoken name (\"the TV\", \"bedroom light\") to a device id before calling home_control_device. Returns id, name, type, room, capabilities, online, state.",
  schema: z.object({
    type: z.enum(["tv", "speaker", "light", "plug", "switch", "thermostat", "sensor", "appliance", "other"]).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["tv", "speaker", "light", "plug", "switch", "thermostat", "sensor", "appliance", "other"],
        description: "Optional filter: only return devices of this type.",
      },
    },
  },
  async run(input, ctx) {
    const home = await getSmartHomeProvider(ctx.supabase, ctx.userId);
    const devices = await home.listDevices();
    return {
      provider: home.providerName,
      devices: input.type ? devices.filter((d) => d.type === input.type) : devices,
    };
  },
});

const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("power"), value: z.enum(["on", "off", "toggle"]) }),
  z.object({ kind: z.literal("volume"), value: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal("volume_step"), value: z.enum(["up", "down"]) }),
  z.object({ kind: z.literal("mute"), value: z.enum(["mute", "unmute", "toggle"]) }),
  z.object({ kind: z.literal("input"), value: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("channel_step"), value: z.enum(["up", "down"]) }),
  z.object({ kind: z.literal("playback"), value: z.enum(["play", "pause", "stop"]) }),
  z.object({ kind: z.literal("brightness"), value: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal("color_temperature"), value: z.number().int().min(1500).max(9000) }),
]);

export const homeControlDeviceTool = defineTool({
  name: "home_control_device",
  description: [
    "Send a command to a smart-home device. Call home_list_devices first to resolve device_id from a user's spoken reference.",
    "",
    "Command shapes (pass one as `command`):",
    "- {kind:'power', value:'on'|'off'|'toggle'} — on/off or flip state.",
    "- {kind:'volume', value:0-100} — absolute volume.",
    "- {kind:'volume_step', value:'up'|'down'} — nudge ±1.",
    "- {kind:'mute', value:'mute'|'unmute'|'toggle'}",
    "- {kind:'input', value:'HDMI1'|'digitalTv'|...} — TV input source name.",
    "- {kind:'channel_step', value:'up'|'down'}",
    "- {kind:'playback', value:'play'|'pause'|'stop'}",
    "- {kind:'brightness', value:0-100} — lights.",
    "- {kind:'color_temperature', value:1500-9000} — kelvin, lights.",
    "",
    "Note: Samsung TVs can only be turned ON remotely if 'Power On with Mobile' is enabled in the TV's network settings. If power:on fails, tell the user to enable that setting.",
  ].join("\n"),
  schema: z.object({
    device_id: z.string().min(1),
    command: commandSchema,
  }),
  inputSchema: {
    type: "object",
    properties: {
      device_id: { type: "string", description: "Device id from home_list_devices." },
      command: {
        type: "object",
        description: "The command object. See tool description for shapes.",
        properties: {
          kind: {
            type: "string",
            enum: [
              "power",
              "volume",
              "volume_step",
              "mute",
              "input",
              "channel_step",
              "playback",
              "brightness",
              "color_temperature",
            ],
          },
          value: {
            description: "Value whose type depends on kind — see tool description.",
          },
        },
        required: ["kind", "value"],
      },
    },
    required: ["device_id", "command"],
  },
  async run(input, ctx) {
    const home = await getSmartHomeProvider(ctx.supabase, ctx.userId);
    const result = await home.executeCommand(input.device_id, input.command as HomeCommand);
    return {
      provider: home.providerName,
      device_id: input.device_id,
      command: input.command,
      ...result,
    };
  },
});
