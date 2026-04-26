// POST /api/soul-maps — generate a fresh soul-map snapshot.
//   body: { decision_window_days?: number (14-365, default 90) }
//
// Server pulls deterministic NODES (identity_claims active, themes active,
// policies active, goals active, decisions in window, people importance>=2)
// then asks Haiku to infer EDGES between them — supports / tension /
// shapes / anchors / connects, each with strength 1-5 and a one-line note.
// Server validates every edge endpoint is one of the nodes it sent (no
// fabrication). Inserts a new soul_maps row with parent_id pointing at the
// most recent active map and a drift_summary contrasting the two.
//
// GET /api/soul-maps — list soul maps (newest first).
//   ?status=active|pinned|archived|all (default active)
//   ?limit=N (default 20, max 60)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 3000;

const VALID_RELATIONS = ["supports", "tension", "shapes", "anchors", "connects"] as const;
type Relation = (typeof VALID_RELATIONS)[number];

type Node = { id: string; kind: "identity" | "theme" | "policy" | "goal" | "decision" | "person"; subkind?: string | null; label: string; weight: number; ref_id: string };
type Edge = { source: string; target: string; relation: Relation; strength: number; note: string };

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function shortLabel(s: string, n = 48): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length > n ? `${cleaned.slice(0, n - 1)}…` : cleaned;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { decision_window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const winRaw = typeof body.decision_window_days === "number" ? Math.round(body.decision_window_days) : 90;
  const decisionWindowDays = Math.max(14, Math.min(365, winRaw));
  const decisionSinceIso = new Date(Date.now() - decisionWindowDays * 86_400_000).toISOString();

  const [idRes, thRes, polRes, goRes, decRes, peRes] = await Promise.all([
    supabase.from("identity_claims").select("id, kind, statement, occurrences").eq("user_id", user.id).eq("status", "active").order("occurrences", { ascending: false }).limit(20),
    supabase.from("themes").select("id, title, kind, current_state").eq("user_id", user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(15),
    supabase.from("policies").select("id, name, rule, category, priority").eq("user_id", user.id).eq("status", "active").order("priority", { ascending: false }).limit(15),
    supabase.from("goals").select("id, title, why, kind, target_date").eq("user_id", user.id).eq("status", "active").order("target_date", { ascending: true }).limit(12),
    supabase.from("decisions").select("id, title, choice, expected_outcome, created_at").eq("user_id", user.id).gte("created_at", decisionSinceIso).order("created_at", { ascending: false }).limit(15),
    supabase.from("people").select("id, name, relation, importance").eq("user_id", user.id).gte("importance", 2).order("importance", { ascending: false }).limit(12),
  ]);

  const nodes: Node[] = [];
  const counts: Record<string, number> = {};

  for (const r of (idRes.data ?? []) as Array<{ id: string; kind: string; statement: string; occurrences: number | null }>) {
    nodes.push({ id: `id:${r.id.slice(0, 8)}`, kind: "identity", subkind: r.kind, label: shortLabel(r.statement), weight: Math.max(1, Math.min(5, r.occurrences ?? 1)), ref_id: r.id });
  }
  counts.identity = (idRes.data ?? []).length;

  for (const r of (thRes.data ?? []) as Array<{ id: string; title: string; kind: string; current_state: string | null }>) {
    nodes.push({ id: `th:${r.id.slice(0, 8)}`, kind: "theme", subkind: r.kind, label: shortLabel(r.title), weight: 3, ref_id: r.id });
  }
  counts.themes = (thRes.data ?? []).length;

  for (const r of (polRes.data ?? []) as Array<{ id: string; name: string; rule: string; category: string; priority: number | null }>) {
    nodes.push({ id: `pol:${r.id.slice(0, 8)}`, kind: "policy", subkind: r.category, label: shortLabel(r.name), weight: Math.max(1, Math.min(5, r.priority ?? 3)), ref_id: r.id });
  }
  counts.policies = (polRes.data ?? []).length;

  for (const r of (goRes.data ?? []) as Array<{ id: string; title: string; kind: string; target_date: string | null }>) {
    nodes.push({ id: `go:${r.id.slice(0, 8)}`, kind: "goal", subkind: r.kind, label: shortLabel(r.title), weight: 3, ref_id: r.id });
  }
  counts.goals = (goRes.data ?? []).length;

  for (const r of (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; created_at: string }>) {
    nodes.push({ id: `dec:${r.id.slice(0, 8)}`, kind: "decision", label: shortLabel(r.title), weight: 2, ref_id: r.id });
  }
  counts.decisions = (decRes.data ?? []).length;

  for (const r of (peRes.data ?? []) as Array<{ id: string; name: string; relation: string; importance: number | null }>) {
    nodes.push({ id: `pe:${r.id.slice(0, 8)}`, kind: "person", subkind: r.relation, label: shortLabel(r.name), weight: Math.max(1, Math.min(5, r.importance ?? 2)), ref_id: r.id });
  }
  counts.people = (peRes.data ?? []).length;

  if (nodes.length < 6) {
    return NextResponse.json({ error: "not enough material to map yet — log more identity claims, themes, policies, or goals first" }, { status: 400 });
  }

  // Build a node-id → row index for validation, plus a richer dump for the model.
  const idSet = new Set(nodes.map((n) => n.id));
  const dump: string[] = [];
  const grouped = new Map<Node["kind"], Node[]>();
  for (const n of nodes) {
    const arr = grouped.get(n.kind);
    if (arr) arr.push(n); else grouped.set(n.kind, [n]);
  }
  const KIND_LABEL: Record<Node["kind"], string> = {
    identity: "IDENTITY CLAIMS (what the user has stated about themselves)",
    theme: "ACTIVE THEMES (story arcs the user is in)",
    policy: "POLICIES (rules the user has set)",
    goal: "ACTIVE GOALS",
    decision: `RECENT DECISIONS (last ${decisionWindowDays}d)`,
    person: "PEOPLE WHO MATTER (importance ≥ 2)",
  };
  for (const kind of ["identity", "theme", "policy", "goal", "decision", "person"] as const) {
    const arr = grouped.get(kind);
    if (!arr || arr.length === 0) continue;
    dump.push(KIND_LABEL[kind]);
    for (const n of arr) {
      dump.push(`  ${n.id} ${n.subkind ? `[${n.subkind}] ` : ""}${n.label}`);
    }
    dump.push("");
  }

  // Pull previous map for drift comparison
  const { data: previous } = await supabase
    .from("soul_maps")
    .select("id, nodes, edges, centroid_summary, created_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const system = [
    "You are mapping the user's INNER ARCHITECTURE — a graph of how their stated identity, themes, policies, goals, decisions, and important people relate to each other.",
    "",
    "You will be given a list of NODES with stable ids. Your job is to infer EDGES between them — only edges where you can point to a real connection in the data.",
    "",
    "Output strict JSON:",
    "{",
    `  "edges": [{ "source": "<node_id>", "target": "<node_id>", "relation": "supports" | "tension" | "shapes" | "anchors" | "connects", "strength": 1-5, "note": "<one short sentence quoting a phrase from each side>" }, ...],`,
    `  "centroid_summary": "<one paragraph, 80-140 words, third person, naming the 2-3 strongest clusters in the graph and what they reveal about who this person currently IS. Don't list edges. Describe the architecture.>",`,
    `  "drift_summary": "<optional. ONE sentence, 12-30 words, second person 'you', naming the SHIFT between the previous map and this one — what's gone, what's appeared, what's strengthened or loosened. Omit when no previous map exists.>"`,
    "}",
    "",
    "Edge rules:",
    "- ONLY use node ids from the provided list. Do not invent ids. Any edge whose endpoints aren't in the list will be discarded.",
    "- 8 to 25 edges total. Pick the most LOAD-BEARING ones, not every weak adjacency.",
    "- relation meanings:",
    "    supports — A reinforces B (an identity claim supports a goal; a policy supports a theme).",
    "    tension — A pulls against B (a value vs a decision; a goal vs a policy; an aspiration vs a recent action).",
    "    shapes — A is upstream of B (a theme shapes a decision; an identity claim shapes a policy).",
    "    anchors — A is what B is rooted in (a person anchors a theme; a value anchors a refusal).",
    "    connects — generic semantic adjacency when none of the above fit precisely.",
    "- strength 1-5 (5 = load-bearing, 1 = weak hint).",
    "- note: ONE sentence, ≤140 chars, quoting or paraphrasing a phrase from each side so the user can see why you drew the edge.",
    "- Don't connect everything to everything. Only draw the edges that name a real relation.",
    "- Cross-kind edges (identity↔goal, theme↔decision, policy↔person) are usually more interesting than within-kind ones.",
    "",
    "Centroid summary rules: third person, British English, no em-dashes, no advice, no questions. Name the architecture, not the contents.",
    "Drift rules: name the actual movement. Skip when no previous map.",
  ].join("\n");

  const userMsg = [
    "NODES:",
    "",
    dump.join("\n"),
    previous ? `\n=== PREVIOUS MAP (written ${(previous.created_at as string).slice(0, 10)}) ===\n${(previous.centroid_summary as string | null) ?? "(no centroid summary)"}` : "\n(no previous map exists yet — omit drift_summary)",
  ].join("\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  let raw = "";
  let model = MODEL;
  let switched = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userMsg }],
      });
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no text block");
      raw = block.text.trim();
      break;
    } catch (e) {
      if (!switched && isOverloaded(e)) { switched = true; model = FALLBACK_MODEL; continue; }
      return NextResponse.json({ error: e instanceof Error ? e.message : "haiku failed" }, { status: 502 });
    }
  }

  let parsed: { edges?: unknown; centroid_summary?: unknown; drift_summary?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const edges: Edge[] = [];
  const seenPair = new Set<string>();
  if (Array.isArray(parsed.edges)) {
    for (const item of parsed.edges) {
      if (typeof item !== "object" || !item) continue;
      const o = item as Record<string, unknown>;
      const source = typeof o.source === "string" ? o.source : "";
      const target = typeof o.target === "string" ? o.target : "";
      const relation = typeof o.relation === "string" ? o.relation : "";
      if (!idSet.has(source) || !idSet.has(target)) continue;
      if (source === target) continue;
      if (!VALID_RELATIONS.includes(relation as Relation)) continue;
      const key = `${source}|${target}|${relation}`;
      const reverseKey = `${target}|${source}|${relation}`;
      if (seenPair.has(key) || seenPair.has(reverseKey)) continue;
      seenPair.add(key);
      const strength = typeof o.strength === "number" ? Math.max(1, Math.min(5, Math.round(o.strength))) : 3;
      const note = typeof o.note === "string" ? o.note.trim().slice(0, 280) : "";
      edges.push({ source, target, relation: relation as Relation, strength, note });
      if (edges.length >= 30) break;
    }
  }

  if (edges.length < 3) {
    return NextResponse.json({ error: "model returned too few valid edges", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const centroidSummary = typeof parsed.centroid_summary === "string" ? parsed.centroid_summary.trim().slice(0, 1800) : "";
  const driftSummary = typeof parsed.drift_summary === "string" ? parsed.drift_summary.trim().slice(0, 400) : "";

  const { data: inserted, error: iErr } = await supabase
    .from("soul_maps")
    .insert({
      user_id: user.id,
      nodes,
      edges,
      centroid_summary: centroidSummary || null,
      drift_summary: previous && driftSummary ? driftSummary : null,
      parent_id: previous?.id ?? null,
      source_counts: counts,
    })
    .select("id, nodes, edges, centroid_summary, drift_summary, source_counts, parent_id, pinned, archived_at, user_note, created_at")
    .single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  return NextResponse.json({ map: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "active";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(60, limitRaw)) : 20;

  let q = supabase
    .from("soul_maps")
    .select("id, nodes, edges, centroid_summary, drift_summary, source_counts, parent_id, pinned, archived_at, user_note, created_at")
    .eq("user_id", user.id);
  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  q = q.order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ maps: data ?? [] });
}
