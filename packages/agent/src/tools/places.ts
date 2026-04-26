// Brain-level tools for resolving "where is the user" and "where is this named
// place" questions. Lets the brain answer "order me an Uber home" or "from my
// current location" without asking the user to paste coordinates.
//
// - get_current_location → latest browser-reported fix on the profile
// - lookup_place(label)  → a row from saved_places matched by label
// - list_saved_places    → all labelled places for the user
//
// add_saved_place already exists in automations.ts and writes to the same
// table.

import { z } from "zod";
import { defineTool } from "./types";

const CURRENT_STALE_AFTER_MIN = 30;

export const getCurrentLocationTool = defineTool({
  name: "get_current_location",
  description: [
    "Return the user's most recently reported GPS location (from their browser / desktop app).",
    "Use this whenever the user says 'from my current location', 'where I am', 'here', 'nearby',",
    "or when a task needs a pickup point and the user hasn't pasted one. DO NOT ask the user for",
    "their location — call this first. If it returns stale=true, the fix is older than 30 minutes;",
    "you may still use it but note it silently. If it returns not_available, then (and only then)",
    "ask the user to share their location.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [] },
  async run(_input, ctx) {
    const { data } = await ctx.supabase
      .from("profiles")
      .select("current_lat, current_lng, current_accuracy_m, current_location_at")
      .eq("id", ctx.userId)
      .maybeSingle();
    if (!data?.current_lat || !data?.current_lng) {
      return { ok: false, not_available: true };
    }
    const at = data.current_location_at as string | null;
    const ageMin = at ? (Date.now() - new Date(at).getTime()) / 60000 : null;
    return {
      ok: true,
      lat: data.current_lat,
      lng: data.current_lng,
      accuracy_m: data.current_accuracy_m ?? null,
      at,
      stale: ageMin != null && ageMin > CURRENT_STALE_AFTER_MIN,
      age_minutes: ageMin != null ? Math.round(ageMin) : null,
    };
  },
});

export const lookupPlaceTool = defineTool({
  name: "lookup_place",
  description: [
    "Look up one of the user's saved places by label (e.g. 'home', 'studio', 'mum's', 'gym').",
    "Matches case-insensitively. Use this when the user references a named place instead of a",
    "coordinate ('order me an Uber home', 'I'm leaving mum's', 'how long to the studio?').",
    "DO NOT ask the user for the address — call this first. If it returns not_found, fall back",
    "to get_current_location or ask once.",
  ].join("\n"),
  schema: z.object({
    label: z.string().min(1).max(60),
  }),
  inputSchema: {
    type: "object",
    properties: {
      label: { type: "string", description: "The name the user calls the place." },
    },
    required: ["label"],
  },
  async run(input, ctx) {
    const { data } = await ctx.supabase
      .from("saved_places")
      .select("id, label, address, lat, lng, radius_m")
      .eq("user_id", ctx.userId)
      .ilike("label", input.label)
      .maybeSingle();
    if (!data) {
      return { ok: false, not_found: true, label: input.label };
    }
    return {
      ok: true,
      id: data.id,
      label: data.label,
      address: data.address,
      lat: data.lat,
      lng: data.lng,
      radius_m: data.radius_m,
    };
  },
});

export const listSavedPlacesTool = defineTool({
  name: "list_saved_places",
  description: [
    "Return all of the user's saved places. Use when the user asks 'what places have you saved'",
    "or when you need to pick the best-matching place from several possibilities.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [] },
  async run(_input, ctx) {
    const { data } = await ctx.supabase
      .from("saved_places")
      .select("id, label, address, lat, lng, radius_m")
      .eq("user_id", ctx.userId)
      .order("label");
    return { places: data ?? [] };
  },
});
