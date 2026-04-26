// POST /api/constitutions/generate — distil the user's active
// policies, identity claims (especially value + refuse kinds), recent
// decisions, active themes, and current trajectory into a versioned
// "Living Constitution" — the user's own laws, in their own words,
// with each article citing the source it was distilled from.
//
// Body: {} (no params — uses everything currently active)
//
// On success the new row becomes is_current=true, the previous current
// is demoted to is_current=false, and the new row stores parent_id
// linking back to it. version auto-increments per user.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 3200;

const ARTICLE_KINDS = ["identity", "value", "refuse", "how_i_work", "how_i_decide", "what_im_building"] as const;
type ArticleKind = (typeof ARTICLE_KINDS)[number];

type ParsedArticle = {
  kind: ArticleKind;
  title: string;
  body: string;
  citations: Array<{ kind: string; id: string }>;
};

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

export async function POST(_req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const [policiesRes, identityRes, decisionsRes, themesRes, trajRes, prevRes] = await Promise.all([
    supabase
      .from("policies")
      .select("id, name, rule, category, priority")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("priority", { ascending: false })
      .limit(40),
    supabase
      .from("identity_claims")
      .select("id, kind, statement, occurrences, status, pinned")
      .eq("user_id", user.id)
      .neq("status", "retired")
      .order("pinned", { ascending: false })
      .order("occurrences", { ascending: false })
      .limit(60),
    supabase
      .from("decisions")
      .select("id, title, choice, expected_outcome, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since60)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("themes")
      .select("id, title, kind, current_state")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(20),
    supabase
      .from("trajectories")
      .select("id, body_6m, body_12m, key_drivers")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("constitutions")
      .select("id, version, body, articles")
      .eq("user_id", user.id)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const policies = (policiesRes.data ?? []) as Array<{ id: string; name: string; rule: string; category: string; priority: number }>;
  const claims = (identityRes.data ?? []) as Array<{ id: string; kind: string; statement: string; occurrences: number; status: string; pinned: boolean }>;
  const decisions = (decisionsRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; created_at: string }>;
  const themes = (themesRes.data ?? []) as Array<{ id: string; title: string; kind: string; current_state: string | null }>;
  const trajRow = (trajRes.data ?? [])[0] as { id: string; body_6m: string; body_12m: string; key_drivers: string[] } | undefined;
  const prev = (prevRes.data ?? [])[0] as { id: string; version: number; body: string; articles: unknown } | undefined;

  const sourceCount = policies.length + claims.length + decisions.length + themes.length + (trajRow ? 1 : 0);
  if (sourceCount < 5) {
    return NextResponse.json({
      error: "not enough active sources to distil a constitution. Log a few policies, run identity extraction, or generate a trajectory first.",
    }, { status: 400 });
  }

  const seenIds = new Set<string>();
  for (const p of policies) seenIds.add(`policy#${p.id}`);
  for (const c of claims) seenIds.add(`identity#${c.id}`);
  for (const d of decisions) seenIds.add(`decision#${d.id}`);
  for (const t of themes) seenIds.add(`theme#${t.id}`);
  if (trajRow) seenIds.add(`trajectory#${trajRow.id}`);

  const dump = [
    `TODAY: ${new Date().toISOString().slice(0, 10)}`,
    "",
    policies.length ? `ACTIVE POLICIES (${policies.length}, hard rules, sorted by priority):\n${policies.map((p) => `- policy#${p.id} [${p.category}/p${p.priority}] ${p.name}: ${p.rule}`).join("\n")}` : null,
    claims.length ? `IDENTITY CLAIMS (${claims.length}, the user's own words):\n${claims.map((c) => `- identity#${c.id} [${c.kind}/${c.status}/x${c.occurrences}${c.pinned ? "/pinned" : ""}] ${c.statement}`).join("\n")}` : null,
    decisions.length ? `RECENT DECISIONS (last 60d, direction signal):\n${decisions.map((d) => `- decision#${d.id} (${d.created_at.slice(0, 10)}) ${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}${d.expected_outcome ? ` — expected: ${d.expected_outcome}` : ""}`).join("\n")}` : null,
    themes.length ? `ACTIVE THEMES (${themes.length}, what the user is currently working through):\n${themes.map((t) => `- theme#${t.id} [${t.kind}] ${t.title}${t.current_state ? ` — ${t.current_state}` : ""}`).join("\n")}` : null,
    trajRow ? `LATEST TRAJECTORY (trajectory#${trajRow.id}):\nKEY DRIVERS: ${(trajRow.key_drivers ?? []).join(" · ")}\n6 MONTHS:\n${trajRow.body_6m}\n12 MONTHS:\n${trajRow.body_12m}` : null,
    prev ? `PREVIOUS CONSTITUTION (v${prev.version}, the version this is replacing — read it then write the NEW version, noting in diff_summary what has shifted):\n${prev.body}` : null,
  ].filter(Boolean).join("\n\n");

  const system = [
    "You are distilling the user's LIVING CONSTITUTION — their own laws, in their own words, drawn entirely from data they themselves have written. This is not advice, not best-practice, not a coaching template. This is the user's own operating manual.",
    "",
    "Output strict JSON: {",
    "  \"preamble\": string (1-2 sentence opening that names who this constitution belongs to and what it stands for),",
    "  \"articles\": [ { \"kind\": \"identity\"|\"value\"|\"refuse\"|\"how_i_work\"|\"how_i_decide\"|\"what_im_building\", \"title\": string (short clause name, sentence case), \"body\": string (1-3 sentences in second person, declarative, the rule itself), \"citations\": [ { \"kind\": \"policy\"|\"identity\"|\"decision\"|\"theme\"|\"trajectory\", \"id\": string } ] } ],",
    "  \"diff_summary\": string|null (1-3 sentences naming what has SHIFTED from the previous constitution if one is provided, otherwise null)",
    "}",
    "",
    "No prose outside the JSON.",
    "",
    "Rules:",
    "- 8 to 14 articles total. Don't pad. Don't repeat.",
    "- Cover all six kinds if possible (identity, value, refuse, how_i_work, how_i_decide, what_im_building) but only include a kind if the source data supports it.",
    "- Every article MUST cite at least 1 source from the dump using the exact tagged id (e.g. policy#abc, identity#xyz). NEVER invent ids. NEVER cite something not in the dump. If you can't cite, don't write the article.",
    "- Prefer specific, idiosyncratic clauses over generic ones. 'You don't take meetings before 11' beats 'You value deep work'.",
    "- Use second person ('You are X', 'You refuse X', 'You build by Y'). Warm but firm. British English. No em-dashes. No moralising.",
    "- 'refuse' articles capture hard lines (never X, won't Y).",
    "- 'how_i_work' captures process/cadence (when, how often, with whom).",
    "- 'how_i_decide' captures decision heuristics ('you ask future-you before any decision over £X', 'you sleep on it 24h').",
    "- 'what_im_building' captures current direction grounded in trajectory + recent decisions.",
    "- diff_summary should name a SHIFT: a clause sharpened, a refusal softened, a value added or retired. Quiet evolution counts. If nothing has meaningfully shifted, write a short honest note saying so.",
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
        messages: [{ role: "user", content: dump }],
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

  let parsed: { preamble?: unknown; articles?: unknown; diff_summary?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const preamble = typeof parsed.preamble === "string" ? parsed.preamble.trim().slice(0, 600) : null;

  const articlesIn: ParsedArticle[] = [];
  if (Array.isArray(parsed.articles)) {
    for (const a of parsed.articles as Array<Record<string, unknown>>) {
      const kindVal = typeof a.kind === "string" ? a.kind : "";
      const title = typeof a.title === "string" ? a.title.trim() : "";
      const body = typeof a.body === "string" ? a.body.trim() : "";
      if (!ARTICLE_KINDS.includes(kindVal as ArticleKind)) continue;
      if (title.length < 2 || body.length < 8) continue;
      const citations: Array<{ kind: string; id: string }> = [];
      if (Array.isArray(a.citations)) {
        for (const c of a.citations as Array<Record<string, unknown>>) {
          const ck = typeof c.kind === "string" ? c.kind : "";
          const ci = typeof c.id === "string" ? c.id : "";
          if (!ck || !ci) continue;
          const tagged = `${ck}#${ci}`;
          if (!seenIds.has(tagged)) continue;
          citations.push({ kind: ck, id: ci });
        }
      }
      if (citations.length === 0) continue;
      articlesIn.push({
        kind: kindVal as ArticleKind,
        title: title.slice(0, 120),
        body: body.slice(0, 800),
        citations: citations.slice(0, 6),
      });
    }
  }

  if (articlesIn.length < 4) {
    return NextResponse.json({
      error: "constitution had too few grounded articles",
      raw: raw.slice(0, 400),
    }, { status: 502 });
  }

  const articles = articlesIn.slice(0, 14);

  const kindLabel: Record<ArticleKind, string> = {
    identity: "Identity",
    value: "Values",
    refuse: "Refusals",
    how_i_work: "How you work",
    how_i_decide: "How you decide",
    what_im_building: "What you're building",
  };
  const grouped: Record<ArticleKind, ParsedArticle[]> = {
    identity: [], value: [], refuse: [], how_i_work: [], how_i_decide: [], what_im_building: [],
  };
  for (const a of articles) grouped[a.kind].push(a);

  const bodyParts: string[] = [];
  if (preamble) bodyParts.push(preamble);
  for (const k of ARTICLE_KINDS) {
    const arr = grouped[k];
    if (arr.length === 0) continue;
    bodyParts.push(`## ${kindLabel[k]}`);
    for (const a of arr) bodyParts.push(`### ${a.title}\n${a.body}`);
  }
  const fullBody = bodyParts.join("\n\n").slice(0, 16_000);

  const diffSummary = typeof parsed.diff_summary === "string"
    ? parsed.diff_summary.trim().slice(0, 800) || null
    : null;

  const sourceCounts = {
    policies: policies.length,
    identity_claims: claims.length,
    decisions: decisions.length,
    themes: themes.length,
    trajectory: trajRow ? 1 : 0,
    articles: articles.length,
  };

  const nextVersion = (prev?.version ?? 0) + 1;

  if (prev) {
    await supabase
      .from("constitutions")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("id", prev.id)
      .eq("user_id", user.id);
  }

  const { data: inserted, error } = await supabase
    .from("constitutions")
    .insert({
      user_id: user.id,
      version: nextVersion,
      parent_id: prev?.id ?? null,
      preamble,
      body: fullBody,
      articles,
      source_counts: sourceCounts,
      diff_summary: diffSummary,
      is_current: true,
    })
    .select("id, version, parent_id, preamble, body, articles, source_counts, diff_summary, is_current, pinned, archived_at, created_at")
    .single();
  if (error) {
    if (prev) {
      await supabase
        .from("constitutions")
        .update({ is_current: true })
        .eq("id", prev.id)
        .eq("user_id", user.id);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ constitution: inserted });
}
