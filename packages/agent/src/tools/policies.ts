// Brain tools for policies — reusable rules JARVIS enforces autonomously
// when acting on the user's behalf. "I don't take meetings before 11",
// "spend over £100 needs my approval", "no replies on weekends". The brain
// should call check_policies BEFORE scheduling, drafting, sending, or
// committing on behalf of the user — surfaces matching rules so the brain
// can refuse, counter-propose, or escalate to the user.
//
// Distinct from decisions (one-time committed past choice — "I'm hiring X")
// and goals (target outcome — "ship 100k MRR"). Policies are evergreen
// guardrails that fire whenever a situation matches.

import { z } from "zod";
import { defineTool } from "./types";

const VALID_CATEGORIES = [
  "scheduling",
  "communication",
  "finance",
  "health",
  "relationships",
  "work",
  "general",
] as const;

type PolicyRow = {
  id: string;
  name: string;
  rule: string;
  category: string;
  priority: number;
  active: boolean;
  examples: string | null;
  tags: string[];
  updated_at: string;
};

export const savePolicyTool = defineTool({
  name: "save_policy",
  description: [
    "Save or update a policy — a reusable rule JARVIS will enforce when",
    "acting on the user's behalf. Required: name (slug-style, ≤80 chars)",
    "and rule (the rule itself in the user's voice, ≤2000 chars).",
    "Optional: category (scheduling/communication/finance/health/",
    "relationships/work/general — default general), priority (1-5,",
    "default 3 — 5 = inviolable, 1 = soft), examples (when does this fire),",
    "tags. Upserts on (user_id, name).",
    "",
    "Use when the user says 'always X' / 'never Y' / 'rule: Z' / 'don't",
    "let me X' or when you notice a recurring constraint they've stated.",
  ].join("\n"),
  schema: z.object({
    name: z.string().min(1).max(80),
    rule: z.string().min(1).max(2000),
    category: z.enum(VALID_CATEGORIES).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    examples: z.string().max(2000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["name", "rule"],
    properties: {
      name: { type: "string" },
      rule: { type: "string" },
      category: { type: "string", enum: [...VALID_CATEGORIES] },
      priority: { type: "number", description: "1-5, where 5 is inviolable" },
      examples: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("policies")
      .upsert(
        {
          user_id: ctx.userId,
          name: input.name.trim().slice(0, 80),
          rule: input.rule.trim().slice(0, 2000),
          category: input.category ?? "general",
          priority: input.priority ?? 3,
          examples: input.examples?.trim().slice(0, 2000) || null,
          tags: input.tags ?? [],
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,name" },
      )
      .select("id, name, category, priority")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; name: string; category: string; priority: number };
    return { ok: true, id: r.id, name: r.name, category: r.category, priority: r.priority };
  },
});

export const listPoliciesTool = defineTool({
  name: "list_policies",
  description: [
    "List the user's policies. Optional: category filter, active (default",
    "true), limit. Sorted by priority desc then updated_at desc. Returns",
    "name, rule, category, priority, examples, tags. Use this for a full",
    "audit ('show me all my policies') — for situational matching against",
    "a specific request, prefer check_policies.",
  ].join("\n"),
  schema: z.object({
    category: z.enum(VALID_CATEGORIES).optional(),
    active: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }),
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: [...VALID_CATEGORIES] },
      active: { type: "boolean" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 50;
    const active = input.active ?? true;
    let q = ctx.supabase
      .from("policies")
      .select("id, name, rule, category, priority, active, examples, tags, updated_at")
      .eq("user_id", ctx.userId)
      .eq("active", active);
    if (input.category) q = q.eq("category", input.category);
    q = q.order("priority", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as PolicyRow[];
    return {
      ok: true,
      count: rows.length,
      policies: rows.map((r) => ({
        name: r.name,
        rule: r.rule,
        category: r.category,
        priority: r.priority,
        examples: r.examples,
        tags: r.tags,
      })),
    };
  },
});

export const checkPoliciesTool = defineTool({
  name: "check_policies",
  description: [
    "Check the user's active policies against a situation BEFORE acting on",
    "their behalf. Pass: situation (free-text description of what you're",
    "about to do — 'accepting a Tuesday 09:30 meeting with X', 'drafting",
    "a £400 Stripe refund', 'replying to email at 11pm Sunday'). Optional:",
    "categories filter to narrow the check.",
    "",
    "Returns all active policies in the matching categories — the brain",
    "must read them and decide whether the situation violates any. If a",
    "P5 policy is violated, refuse and tell the user. If a P3-4, refuse",
    "but propose an alternative. If a P1-2, mention it but proceed unless",
    "the user has previously corrected you on it.",
    "",
    "Call this BEFORE scheduling meetings, drafting outbound messages,",
    "spending money, accepting work, or committing to anything on the",
    "user's behalf.",
  ].join("\n"),
  schema: z.object({
    situation: z.string().min(1).max(500),
    categories: z.array(z.enum(VALID_CATEGORIES)).max(7).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["situation"],
    properties: {
      situation: {
        type: "string",
        description: "Free-text description of what you're about to do",
      },
      categories: {
        type: "array",
        items: { type: "string", enum: [...VALID_CATEGORIES] },
        description: "Optional category filter",
      },
    },
  },
  async run(input, ctx) {
    let q = ctx.supabase
      .from("policies")
      .select("name, rule, category, priority, examples, tags")
      .eq("user_id", ctx.userId)
      .eq("active", true);
    if (input.categories && input.categories.length > 0) {
      q = q.in("category", input.categories);
    }
    q = q.order("priority", { ascending: false }).order("updated_at", { ascending: false });
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<{
      name: string;
      rule: string;
      category: string;
      priority: number;
      examples: string | null;
      tags: string[];
    }>;
    return {
      ok: true,
      situation: input.situation,
      count: rows.length,
      reminder:
        "Read each policy and judge whether the situation would violate it. P5 = inviolable (refuse). P3-4 = refuse + counter-propose. P1-2 = mention but proceed unless user has corrected before.",
      policies: rows,
    };
  },
});

export const deletePolicyTool = defineTool({
  name: "delete_policy",
  description: "Delete a policy by name (exact, case-insensitive).",
  schema: z.object({
    name: z.string().min(1).max(80),
  }),
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
  async run(input, ctx) {
    const { data: row } = await ctx.supabase
      .from("policies")
      .select("id, name")
      .eq("user_id", ctx.userId)
      .ilike("name", input.name.trim())
      .maybeSingle();
    if (!row) return { ok: false, error: `no policy named '${input.name.trim()}'` };
    const r = row as { id: string; name: string };
    const { error } = await ctx.supabase
      .from("policies")
      .delete()
      .eq("id", r.id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, deleted: r.name };
  },
});
