// People CRM brain tools. /people is the writable counterpart to /contacts:
// the user explicitly curates who matters, tags relationships, sets reconnect
// cadences, and logs interactions. These tools let the brain log new people,
// log interactions, search, surface reconnect-overdue people, and pull a
// person's full record + recent interaction history.

import { z } from "zod";
import { defineTool } from "./types";

const RELATIONS = [
  "friend",
  "family",
  "team",
  "customer",
  "prospect",
  "investor",
  "founder",
  "mentor",
  "vendor",
  "press",
  "other",
] as const;

const KINDS = [
  "call",
  "meeting",
  "email",
  "dm",
  "whatsapp",
  "sms",
  "event",
  "intro",
  "other",
] as const;

const SENTIMENTS = ["positive", "neutral", "negative"] as const;

type PersonRow = {
  id: string;
  name: string;
  relation: string;
  importance: number;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  tags: string[];
  last_interaction_at: string | null;
  reconnect_every_days: number | null;
};

type InteractionRow = {
  id: string;
  kind: string;
  summary: string;
  sentiment: string | null;
  occurred_at: string;
};

export const logPersonTool = defineTool({
  name: "log_person",
  description: [
    "Add someone to the user's people CRM. Required: name. Optional: relation",
    "(friend|family|team|customer|prospect|investor|founder|mentor|vendor|press|other),",
    "importance (1=high, 2=med, 3=low), email, phone, company, role, notes,",
    "tags, reconnect_every_days (cadence in days for reconnect nudges).",
    "",
    "Use proactively when the user mentions someone substantively for the",
    "first time ('met an investor today named Sarah at Sequoia', 'my mentor",
    "Tom at Acme'). Different from save_memory (passive context) — this",
    "creates a structured CRM row with interaction history downstream.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(1).max(120),
    relation: z.enum(RELATIONS).optional(),
    importance: z.number().int().min(1).max(3).optional(),
    email: z.string().max(200).optional(),
    phone: z.string().max(50).optional(),
    company: z.string().max(200).optional(),
    role: z.string().max(200).optional(),
    notes: z.string().max(4000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
    reconnect_every_days: z.number().int().min(1).max(365).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      relation: { type: "string", enum: [...RELATIONS] },
      importance: { type: "number" },
      email: { type: "string" },
      phone: { type: "string" },
      company: { type: "string" },
      role: { type: "string" },
      notes: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      reconnect_every_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("people")
      .insert({
        user_id: ctx.userId,
        name: input.name.trim().slice(0, 120),
        relation: input.relation ?? "other",
        importance: input.importance ?? 2,
        email: input.email?.trim().slice(0, 200) || null,
        phone: input.phone?.trim().slice(0, 50) || null,
        company: input.company?.trim().slice(0, 200) || null,
        role: input.role?.trim().slice(0, 200) || null,
        notes: input.notes?.trim().slice(0, 4000) || null,
        tags: input.tags ?? [],
        reconnect_every_days: input.reconnect_every_days ?? null,
      })
      .select("id, name, relation")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; name: string; relation: string };
    return { ok: true, id: r.id, name: r.name, relation: r.relation };
  },
});

async function resolvePerson(
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
  identifier: { id?: string; name?: string },
): Promise<
  | { ok: true; row: PersonRow }
  | { ok: false; error: string }
  | { ok: false; ambiguous: true; candidates: { id: string; name: string; relation: string; company: string | null }[] }
> {
  if (identifier.id) {
    const { data } = await ctx.supabase
      .from("people")
      .select("id, name, relation, importance, email, phone, company, role, notes, tags, last_interaction_at, reconnect_every_days")
      .eq("user_id", ctx.userId)
      .eq("id", identifier.id)
      .maybeSingle();
    if (!data) return { ok: false, error: `no person with id ${identifier.id}` };
    return { ok: true, row: data as PersonRow };
  }
  const name = identifier.name?.trim();
  if (!name) return { ok: false, error: "id or name required" };

  const { data: exact } = await ctx.supabase
    .from("people")
    .select("id, name, relation, importance, email, phone, company, role, notes, tags, last_interaction_at, reconnect_every_days")
    .eq("user_id", ctx.userId)
    .ilike("name", name)
    .limit(2);
  const exactRows = (exact ?? []) as PersonRow[];
  if (exactRows.length === 1) {
    const row = exactRows[0]!;
    return { ok: true, row };
  }
  if (exactRows.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      candidates: exactRows.map((r) => ({ id: r.id, name: r.name, relation: r.relation, company: r.company })),
    };
  }

  const { data: fuzzy } = await ctx.supabase
    .from("people")
    .select("id, name, relation, importance, email, phone, company, role, notes, tags, last_interaction_at, reconnect_every_days")
    .eq("user_id", ctx.userId)
    .ilike("name", `%${name}%`)
    .limit(5);
  const fuzzyRows = (fuzzy ?? []) as PersonRow[];
  if (fuzzyRows.length === 0) return { ok: false, error: `no person matching '${name}'` };
  if (fuzzyRows.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      candidates: fuzzyRows.map((r) => ({ id: r.id, name: r.name, relation: r.relation, company: r.company })),
    };
  }
  return { ok: true, row: fuzzyRows[0]! };
}

export const logInteractionTool = defineTool({
  name: "log_interaction",
  description: [
    "Log a single interaction with someone in the people CRM. Provide either",
    "person_id or name. Required: summary (what happened, ≤2000 chars).",
    "Optional: kind (call|meeting|email|dm|whatsapp|sms|event|intro|other),",
    "sentiment (positive|neutral|negative), occurred_at (ISO timestamp,",
    "defaults to now). Stamps people.last_interaction_at so reconnect-",
    "suggestions stay accurate. If name is ambiguous (>1 match) returns",
    "ambiguous=true with candidates so the brain can disambiguate.",
    "",
    "Use proactively when the user mentions a real exchange ('had a call",
    "with Sarah, she's interested', 'lunch with Tom yesterday'). Different",
    "from log_commitment (one-sided promise) — this is the bidirectional",
    "log of who you actually spoke to and what was discussed.",
  ].join("\n"),
  schema: z.object({
    person_id: z.string().uuid().optional(),
    name: z.string().max(120).optional(),
    summary: z.string().min(2).max(2000),
    kind: z.enum(KINDS).optional(),
    sentiment: z.enum(SENTIMENTS).optional(),
    occurred_at: z.string().optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["summary"],
    properties: {
      person_id: { type: "string" },
      name: { type: "string" },
      summary: { type: "string" },
      kind: { type: "string", enum: [...KINDS] },
      sentiment: { type: "string", enum: [...SENTIMENTS] },
      occurred_at: { type: "string" },
    },
  },
  async run(input, ctx) {
    const resolved = await resolvePerson(ctx, { id: input.person_id, name: input.name });
    if (!resolved.ok) {
      if ("ambiguous" in resolved) {
        return { ok: false, ambiguous: true, candidates: resolved.candidates };
      }
      return { ok: false, error: resolved.error };
    }
    const person = resolved.row;

    let occurredAt = new Date().toISOString();
    if (input.occurred_at) {
      const d = new Date(input.occurred_at);
      if (!Number.isNaN(d.getTime())) occurredAt = d.toISOString();
    }

    const { data, error } = await ctx.supabase
      .from("person_interactions")
      .insert({
        user_id: ctx.userId,
        person_id: person.id,
        kind: input.kind ?? "other",
        summary: input.summary.trim().slice(0, 2000),
        sentiment: input.sentiment ?? null,
        occurred_at: occurredAt,
      })
      .select("id, kind, summary, sentiment, occurred_at")
      .single();
    if (error) return { ok: false, error: error.message };

    await ctx.supabase
      .from("people")
      .update({ last_interaction_at: occurredAt, updated_at: new Date().toISOString() })
      .eq("id", person.id)
      .eq("user_id", ctx.userId);

    const r = data as InteractionRow;
    return {
      ok: true,
      person: { id: person.id, name: person.name },
      interaction: r,
    };
  },
});

export const listPeopleTool = defineTool({
  name: "list_people",
  description: [
    "List people in the user's CRM. Optional: q (fuzzy across name, company,",
    "role, email, notes), relation (filter to one relation), importance_min",
    "(1, 2, or 3 — only show ≤ this importance level, where 1=high), limit",
    "(default 50, max 200). Sorted by importance asc, last_interaction_at",
    "desc. Returns lightweight rows; use get_person for the full record",
    "with interaction history.",
  ].join("\n"),
  schema: z.object({
    q: z.string().max(80).optional(),
    relation: z.enum(RELATIONS).optional(),
    importance_min: z.number().int().min(1).max(3).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string" },
      relation: { type: "string", enum: [...RELATIONS] },
      importance_min: { type: "number" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 50;
    let q = ctx.supabase
      .from("people")
      .select("id, name, relation, importance, company, role, last_interaction_at, reconnect_every_days, tags")
      .eq("user_id", ctx.userId)
      .is("archived_at", null);
    if (input.relation) q = q.eq("relation", input.relation);
    if (input.importance_min) q = q.lte("importance", input.importance_min);
    if (input.q && input.q.trim()) {
      const needle = input.q.trim().slice(0, 80);
      q = q.or(
        `name.ilike.%${needle}%,company.ilike.%${needle}%,role.ilike.%${needle}%,email.ilike.%${needle}%,notes.ilike.%${needle}%`,
      );
    }
    q = q
      .order("importance", { ascending: true })
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: (data ?? []).length, people: data ?? [] };
  },
});

export const whoToReconnectWithTool = defineTool({
  name: "who_to_reconnect_with",
  description: [
    "Surface people the user has set a reconnect cadence for whose last",
    "interaction is now older than reconnect_every_days (or who have no",
    "interaction at all). Sorted by overdue-most first. Use when the user",
    "asks 'who should I reach out to', 'who am I overdue with', or",
    "proactively in briefings/wraps.",
  ].join("\n"),
  schema: z.object({
    limit: z.number().int().min(1).max(50).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number" } },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 10;
    const { data, error } = await ctx.supabase
      .from("people")
      .select("id, name, relation, importance, company, role, last_interaction_at, reconnect_every_days")
      .eq("user_id", ctx.userId)
      .is("archived_at", null)
      .not("reconnect_every_days", "is", null)
      .order("last_interaction_at", { ascending: true, nullsFirst: true })
      .limit(200);
    if (error) return { ok: false, error: error.message };
    const now = Date.now();
    const overdue = (data ?? [])
      .map((p) => {
        const r = p as PersonRow;
        const cadence = (r.reconnect_every_days ?? 0) * 86400000;
        const last = r.last_interaction_at ? new Date(r.last_interaction_at).getTime() : 0;
        const overdueByDays = Math.floor((now - last - cadence) / 86400000);
        const isOverdue = !r.last_interaction_at || now - last > cadence;
        return { row: r, overdueByDays, isOverdue };
      })
      .filter((x) => x.isOverdue)
      .sort((a, b) => b.overdueByDays - a.overdueByDays)
      .slice(0, limit)
      .map((x) => ({
        id: x.row.id,
        name: x.row.name,
        relation: x.row.relation,
        importance: x.row.importance,
        company: x.row.company,
        role: x.row.role,
        last_interaction_at: x.row.last_interaction_at,
        reconnect_every_days: x.row.reconnect_every_days,
        overdue_by_days: x.overdueByDays > 0 ? x.overdueByDays : 0,
      }));
    return { ok: true, count: overdue.length, people: overdue };
  },
});

export const getPersonTool = defineTool({
  name: "get_person",
  description: [
    "Fetch a single person's full record + recent interaction history.",
    "Provide either id or name (fuzzy match — returns ambiguous=true with",
    "candidates if >1 match). Returns the person fields plus the last 30",
    "interactions in chronological order (most recent first).",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid().optional(),
    name: z.string().max(120).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
  },
  async run(input, ctx) {
    const resolved = await resolvePerson(ctx, { id: input.id, name: input.name });
    if (!resolved.ok) {
      if ("ambiguous" in resolved) {
        return { ok: false, ambiguous: true, candidates: resolved.candidates };
      }
      return { ok: false, error: resolved.error };
    }
    const person = resolved.row;
    const { data: history } = await ctx.supabase
      .from("person_interactions")
      .select("id, kind, summary, sentiment, occurred_at")
      .eq("user_id", ctx.userId)
      .eq("person_id", person.id)
      .order("occurred_at", { ascending: false })
      .limit(30);
    return {
      ok: true,
      person,
      interactions: history ?? [],
    };
  },
});
