// POST /api/time-letters — seal a letter. Body shapes by kind:
//   { kind: "forward",  title, body, target_date }
//      written today, delivered on target_date via WhatsApp.
//   { kind: "posterity", title, body, written_at_date }
//      written today, addressed to the past version of yourself at
//      written_at_date. No delivery — stored for the user to revisit.
//   { kind: "backward", written_at_date, window_days?: 14-365 (default 60) }
//      JARVIS GENERATES a letter voiced AS your past-self at
//      written_at_date, drawn from your actual entries within
//      [written_at_date - window_days, written_at_date]. Title is
//      generated too.
//
// GET /api/time-letters?kind=&status=pending|delivered|posterity|all&limit=N

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2200;

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function isValidDateString(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    kind?: string;
    title?: string;
    body?: string;
    target_date?: string;
    written_at_date?: string;
    window_days?: number;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const kind = body.kind;
  if (kind !== "forward" && kind !== "backward" && kind !== "posterity") {
    return NextResponse.json({ error: "kind must be forward | backward | posterity" }, { status: 400 });
  }

  const today = todayStr();

  if (kind === "forward") {
    const title = (body.title ?? "").trim().slice(0, 80);
    const letter = (body.body ?? "").trim().slice(0, 4000);
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (letter.length < 8) return NextResponse.json({ error: "body required" }, { status: 400 });
    if (!isValidDateString(body.target_date)) return NextResponse.json({ error: "target_date YYYY-MM-DD required" }, { status: 400 });
    if (body.target_date <= today) return NextResponse.json({ error: "target_date must be in the future" }, { status: 400 });
    const target = body.target_date;

    const { data: inserted, error } = await supabase
      .from("time_letters")
      .insert({
        user_id: user.id,
        kind: "forward",
        title,
        body: letter,
        written_at_date: today,
        target_date: target,
      })
      .select("id, kind, title, body, written_at_date, target_date, delivered_at, delivered_via, source_summary, source_counts, latency_ms, model, user_note, pinned, archived_at, cancelled_at, created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ letter: inserted });
  }

  if (kind === "posterity") {
    const title = (body.title ?? "").trim().slice(0, 80);
    const letter = (body.body ?? "").trim().slice(0, 4000);
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (letter.length < 8) return NextResponse.json({ error: "body required" }, { status: 400 });
    if (!isValidDateString(body.written_at_date)) return NextResponse.json({ error: "written_at_date YYYY-MM-DD required" }, { status: 400 });
    if (body.written_at_date >= today) return NextResponse.json({ error: "written_at_date must be in the past" }, { status: 400 });
    const past = body.written_at_date;

    const { data: inserted, error } = await supabase
      .from("time_letters")
      .insert({
        user_id: user.id,
        kind: "posterity",
        title,
        body: letter,
        written_at_date: past,
      })
      .select("id, kind, title, body, written_at_date, target_date, delivered_at, delivered_via, source_summary, source_counts, latency_ms, model, user_note, pinned, archived_at, cancelled_at, created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ letter: inserted });
  }

  // BACKWARD — generate a letter voiced from past-self based on actual entries
  if (!isValidDateString(body.written_at_date)) return NextResponse.json({ error: "written_at_date YYYY-MM-DD required" }, { status: 400 });
  if (body.written_at_date >= today) return NextResponse.json({ error: "written_at_date must be in the past" }, { status: 400 });
  const past = body.written_at_date;
  const windowDaysRaw = typeof body.window_days === "number" ? body.window_days : 60;
  const windowDays = Math.max(14, Math.min(365, Math.round(windowDaysRaw)));

  const t0 = Date.now();
  const startDate = new Date(new Date(past).getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const endDate = past;
  const startIso = startDate + "T00:00:00.000Z";
  const endIso = endDate + "T23:59:59.999Z";

  const [refRes, decRes, winRes, stdRes, ckRes, intRes, themesRes] = await Promise.all([
    supabase.from("reflections").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", startIso).lte("created_at", endIso).order("created_at", { ascending: true }).limit(40),
    supabase.from("decisions").select("id, title, choice, expected_outcome, tags, created_at").eq("user_id", user.id).gte("created_at", startIso).lte("created_at", endIso).order("created_at", { ascending: true }).limit(20),
    supabase.from("wins").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", startIso).lte("created_at", endIso).order("created_at", { ascending: true }).limit(25),
    supabase.from("standups").select("today, blockers, log_date").eq("user_id", user.id).gte("log_date", startDate).lte("log_date", endDate).order("log_date", { ascending: true }).limit(40),
    supabase.from("daily_checkins").select("energy, mood, focus, note, log_date").eq("user_id", user.id).gte("log_date", startDate).lte("log_date", endDate).order("log_date", { ascending: true }).limit(40),
    supabase.from("intentions").select("text, completed_at, log_date").eq("user_id", user.id).gte("log_date", startDate).lte("log_date", endDate).order("log_date", { ascending: true }).limit(40),
    supabase.from("themes").select("title, current_state, status, updated_at").eq("user_id", user.id).lte("updated_at", endIso).order("updated_at", { ascending: false }).limit(8),
  ]);

  const refs = (refRes.data ?? []) as Array<{ id: string; text: string; kind: string; created_at: string }>;
  const decs = (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; tags: string[] | null; created_at: string }>;
  const wins = (winRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>;
  const stds = (stdRes.data ?? []) as Array<{ today: string | null; blockers: string | null; log_date: string }>;
  const cks = (ckRes.data ?? []) as Array<{ energy: number; mood: number; focus: number; note: string | null; log_date: string }>;
  const ints = (intRes.data ?? []) as Array<{ text: string; completed_at: string | null; log_date: string }>;
  const themes = (themesRes.data ?? []) as Array<{ title: string; current_state: string | null; status: string; updated_at: string }>;

  const totalEvidence = refs.length + decs.length + wins.length + stds.filter((s) => s.today).length + cks.length + ints.length;
  if (totalEvidence < 4) {
    return NextResponse.json({ error: "not enough writing in that window to generate a letter — pick a date with at least a few entries before it" }, { status: 400 });
  }

  // Build evidence block
  const lines: string[] = [];
  lines.push(`PERSPECTIVE DATE: ${past}`);
  lines.push(`WINDOW: ${startDate} → ${endDate} (${windowDays} days)`);
  lines.push("");

  if (refs.length) {
    lines.push("REFLECTIONS:");
    for (const r of refs) lines.push(`- ${dateOnly(r.created_at)} [${r.kind}] ${r.text.slice(0, 240)}`);
    lines.push("");
  }
  if (decs.length) {
    lines.push("DECISIONS:");
    for (const d of decs) {
      const tagPart = d.tags && d.tags.length ? ` [${d.tags.slice(0, 3).join(", ")}]` : "";
      lines.push(`- ${dateOnly(d.created_at)} ${d.title}${d.choice ? " — " + d.choice.slice(0, 140) : ""}${d.expected_outcome ? " (expected: " + d.expected_outcome.slice(0, 100) + ")" : ""}${tagPart}`);
    }
    lines.push("");
  }
  if (wins.length) {
    lines.push("WINS:");
    for (const w of wins) lines.push(`- ${dateOnly(w.created_at)} ${w.text.slice(0, 180)}`);
    lines.push("");
  }
  if (stds.length) {
    lines.push("STANDUPS:");
    for (const s of stds) {
      if (s.today) lines.push(`- ${s.log_date} TODAY: ${s.today.slice(0, 180)}${s.blockers ? " | BLOCK: " + s.blockers.slice(0, 100) : ""}`);
    }
    lines.push("");
  }
  if (ints.length) {
    lines.push("INTENTIONS:");
    for (const i of ints) lines.push(`- ${i.log_date} ${i.completed_at ? "✓" : "○"} ${i.text.slice(0, 160)}`);
    lines.push("");
  }
  if (cks.length) {
    const avg = (key: "energy" | "mood" | "focus") => Math.round((cks.reduce((s, c) => s + c[key], 0) / cks.length) * 10) / 10;
    lines.push(`CHECK-IN AVERAGES across window: energy ${avg("energy")}, mood ${avg("mood")}, focus ${avg("focus")}`);
    const recent = cks.slice(-5);
    if (recent.length) {
      lines.push("LAST FEW CHECK-INS:");
      for (const c of recent) lines.push(`- ${c.log_date} E${c.energy} M${c.mood} F${c.focus}${c.note ? ` — ${c.note.slice(0, 140)}` : ""}`);
    }
    lines.push("");
  }
  if (themes.length) {
    lines.push("ACTIVE THEMES AT THE TIME:");
    for (const t of themes) lines.push(`- "${t.title}" [${t.status}]${t.current_state ? ` — ${t.current_state.slice(0, 140)}` : ""}`);
    lines.push("");
  }

  const system = [
    `You are GENERATING A LETTER from the user's PAST self at ${past} to their PRESENT self today.`,
    "",
    "Voice this AS THE PAST SELF, in FIRST PERSON, addressed to 'you' (the present-day reader). The past-self has NO knowledge of anything that happened after the perspective date — they don't know which decisions worked out, which themes resolved, which wins came. They write from inside that moment.",
    "",
    "Output strict JSON ONLY:",
    `{"title": "...", "body": "..."}`,
    "",
    "Rules:",
    "- title: 4-8 words, naming the era from inside it (e.g. 'From the partnership-trap winter', 'Notes from the agency-grind season', 'Letter from before the JARVIS pivot'). Specific, not generic.",
    "- body: 180-320 words. ONE letter. Open with a line that places the past-self in the moment ('I'm writing this on the morning of...', 'It's the third week of...'). Quote actual decisions, themes, blockers, intentions FROM THE EVIDENCE — anchor the letter in real specifics. Don't summarise — write a LETTER. Use phrases like 'I keep thinking about X', 'I'm worried that Y', 'I'm hoping Z'. End with a sentence the past-self might want the future to remember (a wish, a worry, a question, a quiet truth) — NOT a moral, NOT advice.",
    "- The past-self does NOT know the outcome of any decision in the evidence. They state expected outcomes as expectations, not facts.",
    "- British English. No em-dashes. No emoji. No clichés. No moralising. No advice from past-self to future-self — the past-self writes what they're LIVING, not what they want to teach.",
    "- Don't fabricate events not in the evidence.",
    "- The letter sounds like the user when they write reflections — informal, specific, dry. Mirror their voice from the REFLECTIONS section.",
  ].join("\n");

  const userMsg = ["EVIDENCE FROM THE WINDOW:", "", lines.join("\n")].join("\n");

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

  let parsed: { title?: unknown; body?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 80) : "";
  const letter = typeof parsed.body === "string" ? parsed.body.trim().slice(0, 4000) : "";
  if (!title || letter.length < 60) {
    return NextResponse.json({ error: "model returned empty / too-short letter" }, { status: 502 });
  }

  const counts = {
    reflections: refs.length,
    decisions: decs.length,
    wins: wins.length,
    standups: stds.filter((s) => s.today).length,
    checkins: cks.length,
    intentions: ints.length,
    themes: themes.length,
  };
  const sourceSummary = `${totalEvidence} entries from ${startDate} → ${endDate}`;
  const latencyMs = Date.now() - t0;

  const { data: inserted, error } = await supabase
    .from("time_letters")
    .insert({
      user_id: user.id,
      kind: "backward",
      title,
      body: letter,
      written_at_date: past,
      source_summary: sourceSummary,
      source_counts: counts,
      latency_ms: latencyMs,
      model,
    })
    .select("id, kind, title, body, written_at_date, target_date, delivered_at, delivered_via, source_summary, source_counts, latency_ms, model, user_note, pinned, archived_at, cancelled_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ letter: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const kind = url.searchParams.get("kind");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(80, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("time_letters")
    .select("id, kind, title, body, written_at_date, target_date, delivered_at, delivered_via, source_summary, source_counts, latency_ms, model, user_note, pinned, archived_at, cancelled_at, created_at")
    .eq("user_id", user.id);

  if (kind === "forward" || kind === "backward" || kind === "posterity") q = q.eq("kind", kind);

  if (status === "pending") q = q.eq("kind", "forward").is("delivered_at", null).is("cancelled_at", null).is("archived_at", null);
  else if (status === "delivered") q = q.eq("kind", "forward").not("delivered_at", "is", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

  q = q.order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ letters: data ?? [] });
}
