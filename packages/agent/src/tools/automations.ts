import { z } from "zod";
import { defineTool, type ToolContext } from "./types";

// Automation engine tools. The brain creates automations conversationally —
// the user says "next time I'm at Anna's after 11pm, ask me if I want an Uber"
// and the brain calls create_automation with the matching trigger + chain.
//
// Important UX rules baked into these tools:
//   - All automations are user-confirmed at creation. The brain proposes the
//     automation in plain English, the user says yes, then the tool fires.
//     The brain MUST NOT silently create automations from inference alone.
//   - Anything that costs money or messages a third party MUST set ask_first
//     true (the engine sends a WhatsApp confirm before firing the chain).
//   - Trigger specs are JSON shapes per kind. The descriptions below document
//     them — keep in sync with apps/web/lib/automation-engine.ts matchTrigger.

const stepSchema = z.object({
  tool: z
    .string()
    .min(1)
    .describe(
      "Tool name to call. Most brain tools work (notify_user, concierge_agent, draft_email, list_calendar, etc). Engine-specific shortcuts: send_whatsapp / send_sms / make_call (use {body}).",
    ),
  args: z
    .record(z.unknown())
    .describe(
      "Arguments to the tool. String values support {{var}} substitution from the trigger payload (e.g. {{place}}, {{from}}, {{amount}}).",
    ),
});

const createSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe(
      "Short title for the automations list, in the user's voice. Substitution OK ('Uber home from {{place}}').",
    ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("The user's original natural-language phrasing. Stored verbatim for the UI."),
  trigger_kind: z.enum([
    "cron",
    "location_arrived",
    "location_left",
    "email_received",
    "bank_txn",
    "payment_received",
    "calendar_event",
    "periodic_check",
    "inbound_message",
  ]),
  trigger_spec: z
    .record(z.unknown())
    .describe(
      [
        "JSON shape per trigger_kind:",
        "- cron: { rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9' } (RFC 5545 RRULE)",
        "- location_arrived / location_left: { place_id: '<saved_places.id>', after_local?: '23:00', before_local?: '06:00', tz?: 'Europe/London' }",
        "- email_received: { from?: 'boss@x.com', subject_contains?: 'invoice' }",
        "- bank_txn: { min_amount?: 50, max_amount?: 500, category?: 'groceries', merchant_contains?: 'uber' }",
        "- payment_received: { min_amount?: 100 }",
        "- calendar_event: { title_contains?: 'standup', minutes_before?: 10 }",
        "- periodic_check: { check_prompt: 'Is Tokyo BA flight under £400?', interval_minutes?: 30, fire_on?: 'always'|'change' }. Haiku evaluates check_prompt every interval; matched=true fires the chain. fire_on='change' only fires when it flips false→true (good for stock/availability). Use {{summary}} and {{check_value}} in chain args.",
        "- inbound_message: { channel?: 'whatsapp'|'sms', has_media?: true|false, keyword_contains?: 'receipt', from_contains?: '+44...', swallow?: true }. Fires on incoming WhatsApp/SMS. swallow=true stops the brain from also replying conversationally (use for photo-inbox-style rules). Use {{body}}, {{from}}, {{media_url}}, {{media_urls}}, {{channel}} in chain args.",
      ].join("\n"),
    ),
  action_chain: z
    .array(stepSchema)
    .min(1)
    .max(8)
    .describe("Ordered list of {tool, args} steps. Runs top to bottom on every fire."),
  ask_first: z
    .boolean()
    .default(true)
    .describe(
      "If true, send WhatsApp 'shall I do X?' before running. Required for any chain that costs money or messages a third party.",
    ),
});

export const createAutomationTool = defineTool({
  name: "create_automation",
  description: [
    "Create a new automation rule for the user. Use only AFTER the user has explicitly",
    "confirmed they want this set up — never infer and silently create.",
    "",
    "Pattern: user does a thing once or describes a recurring need ('every time I'm at",
    "Anna's after 11pm, ask if I want an Uber'). You parse it into a trigger + action",
    "chain, summarise it back ('I'll ask if you want an Uber every time you're at Anna's",
    "after 11pm — sound right?'), and only call this tool once they confirm.",
    "",
    "Action chains can use any brain tool. Common shortcuts:",
    "- send_whatsapp / send_sms / make_call → reach the user (use args.body)",
    "- concierge_agent → place an order, book a thing (use args.goal)",
    "- draft_email → write a draft for review",
    "- notify_user → richer notification with channel selection",
    "",
    "{{var}} substitution applies to all string args — values come from the trigger",
    "payload merged with saved context (place name, etc).",
  ].join("\n"),
  schema: createSchema,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the list." },
      description: { type: "string", description: "User's original phrasing." },
      trigger_kind: {
        type: "string",
        enum: [
          "cron",
          "location_arrived",
          "location_left",
          "email_received",
          "bank_txn",
          "payment_received",
          "calendar_event",
          "periodic_check",
          "inbound_message",
        ],
      },
      trigger_spec: { type: "object", description: "Per-kind config — see tool description." },
      action_chain: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: { type: "string" },
            args: { type: "object" },
          },
          required: ["tool", "args"],
        },
      },
      ask_first: {
        type: "boolean",
        description: "WhatsApp confirm before each fire. True for money/messaging chains.",
      },
    },
    required: ["title", "trigger_kind", "trigger_spec", "action_chain"],
  },
  async run(input, ctx) {
    // Duplicate guard: warn the brain if there's already an automation with
    // the same trigger_kind and a structurally-similar trigger_spec. We still
    // insert (user may genuinely want two), but surface the collision so the
    // brain can confirm intent before announcing success.
    const dupe = await findDuplicateAutomation(
      ctx.supabase,
      ctx.userId,
      input.trigger_kind,
      input.trigger_spec,
    );

    const insertBody: Record<string, unknown> = {
      user_id: ctx.userId,
      title: input.title,
      trigger_kind: input.trigger_kind,
      trigger_spec: input.trigger_spec,
      action_chain: input.action_chain,
      ask_first: input.ask_first,
      enabled: true,
    };
    if (input.description) insertBody.description = input.description;

    const { data, error } = await ctx.supabase
      .from("automations")
      .insert(insertBody)
      .select("id, title")
      .single();
    if (error) throw new Error(`create_automation: ${error.message}`);
    return {
      automation_id: data.id,
      title: data.title,
      message: dupe
        ? `Automation saved, but a similar one already exists (id=${dupe.id}, title=${JSON.stringify(dupe.title)}). Mention the overlap to the user so they can disable one if it's an accident.`
        : "Automation saved. Confirm to the user in their words.",
      duplicate_of: dupe?.id ?? null,
    };
  },
});

async function findDuplicateAutomation(
  supabase: ToolContext["supabase"],
  userId: string,
  triggerKind: string,
  triggerSpec: unknown,
): Promise<{ id: string; title: string } | null> {
  const { data } = await supabase
    .from("automations")
    .select("id, title, trigger_spec")
    .eq("user_id", userId)
    .eq("trigger_kind", triggerKind)
    .eq("enabled", true)
    .limit(20);
  if (!data || data.length === 0) return null;
  const signature = normalizeTriggerSpec(triggerSpec);
  for (const row of data) {
    if (normalizeTriggerSpec(row.trigger_spec) === signature) {
      return { id: row.id as string, title: (row.title as string) ?? "(untitled)" };
    }
  }
  return null;
}

function normalizeTriggerSpec(spec: unknown): string {
  if (spec == null || typeof spec !== "object") return JSON.stringify(spec ?? null);
  const obj = spec as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    normalized[k] =
      typeof v === "string" ? v.trim().toLowerCase() : v;
  }
  return JSON.stringify(normalized);
}

export const listAutomationsTool = defineTool({
  name: "list_automations",
  description: "List the user's existing automations. Use when they ask 'what have you set up' or want to manage their rules.",
  schema: z.object({
    enabled_only: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      enabled_only: { type: "boolean", description: "Only show enabled rules." },
    },
  },
  async run(input, ctx) {
    let q = ctx.supabase
      .from("automations")
      .select("id, title, description, trigger_kind, ask_first, enabled, last_fired_at, fire_count, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false });
    if (input.enabled_only) q = q.eq("enabled", true);
    const { data, error } = await q;
    if (error) throw new Error(`list_automations: ${error.message}`);
    return { count: data?.length ?? 0, automations: data ?? [] };
  },
});

export const toggleAutomationTool = defineTool({
  name: "toggle_automation",
  description: "Enable or disable an automation. Use when the user wants to pause or delete a rule.",
  schema: z.object({
    automation_id: z.string().uuid(),
    action: z.enum(["enable", "disable", "delete"]),
  }),
  inputSchema: {
    type: "object",
    properties: {
      automation_id: { type: "string" },
      action: { type: "string", enum: ["enable", "disable", "delete"] },
    },
    required: ["automation_id", "action"],
  },
  async run(input, ctx) {
    if (input.action === "delete") {
      const { error } = await ctx.supabase
        .from("automations")
        .delete()
        .eq("id", input.automation_id)
        .eq("user_id", ctx.userId);
      if (error) throw new Error(`toggle_automation: ${error.message}`);
      return { ok: true, action: "deleted" };
    }
    const { error } = await ctx.supabase
      .from("automations")
      .update({ enabled: input.action === "enable", updated_at: new Date().toISOString() })
      .eq("id", input.automation_id)
      .eq("user_id", ctx.userId);
    if (error) throw new Error(`toggle_automation: ${error.message}`);
    return { ok: true, action: input.action };
  },
});

const placeSchema = z.object({
  label: z.string().min(1).max(60).describe("How the user refers to it ('Anna's', 'home', 'mum's')."),
  address: z.string().max(300).optional(),
  lat: z.number(),
  lng: z.number(),
  radius_m: z.number().int().min(30).max(2000).optional(),
});

export const addSavedPlaceTool = defineTool({
  name: "add_saved_place",
  description: [
    "Save a labelled location for the user. Use when they share a location and give it a",
    "name ('this is Anna's', 'remember my mum's address'). Requires lat/lng — get them",
    "from the iPhone Shortcut payload or ask the user to share location.",
  ].join("\n"),
  schema: placeSchema,
  inputSchema: {
    type: "object",
    properties: {
      label: { type: "string" },
      address: { type: "string" },
      lat: { type: "number" },
      lng: { type: "number" },
      radius_m: { type: "number", description: "Geofence radius in metres. Default 150." },
    },
    required: ["label", "lat", "lng"],
  },
  async run(input, ctx) {
    const insertBody: Record<string, unknown> = {
      user_id: ctx.userId,
      label: input.label,
      lat: input.lat,
      lng: input.lng,
    };
    if (input.address) insertBody.address = input.address;
    if (input.radius_m) insertBody.radius_m = input.radius_m;

    const { data, error } = await ctx.supabase
      .from("saved_places")
      .upsert(insertBody, { onConflict: "user_id,label" })
      .select("id, label")
      .single();
    if (error) throw new Error(`add_saved_place: ${error.message}`);
    return { place_id: data.id, label: data.label };
  },
});

const personSchema = z.object({
  label: z.string().min(1).max(60).describe("How the user refers to them ('mum', 'Anna', 'plumber')."),
  full_name: z.string().max(200).optional(),
  phone_e164: z
    .string()
    .regex(/^\+\d{6,15}$/, "phone must be E.164 (+<country><number>)")
    .optional(),
  email: z.string().email().optional(),
});

export const addSavedPersonTool = defineTool({
  name: "add_saved_person",
  description: [
    "Save a labelled contact for the user. Use when they share contact info or want",
    "automations to message a specific person ('whenever a payment lands, text mum').",
  ].join("\n"),
  schema: personSchema,
  inputSchema: {
    type: "object",
    properties: {
      label: { type: "string" },
      full_name: { type: "string" },
      phone_e164: { type: "string", description: "E.164 (+<country><number>)." },
      email: { type: "string" },
    },
    required: ["label"],
  },
  async run(input, ctx) {
    const insertBody: Record<string, unknown> = {
      user_id: ctx.userId,
      label: input.label,
    };
    if (input.full_name) insertBody.full_name = input.full_name;
    if (input.phone_e164) insertBody.phone_e164 = input.phone_e164;
    if (input.email) insertBody.email = input.email;

    const { data, error } = await ctx.supabase
      .from("saved_people")
      .upsert(insertBody, { onConflict: "user_id,label" })
      .select("id, label")
      .single();
    if (error) throw new Error(`add_saved_person: ${error.message}`);
    return { person_id: data.id, label: data.label };
  },
});
