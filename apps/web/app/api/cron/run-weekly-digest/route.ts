// Weekly digest. Aggregates the past 7 days across the journal-style logs
// (intentions, decisions, wins, goals, ideas, questions, daily checkins) and
// sends one composed WhatsApp message per opted-in user. Runs Sunday evening
// in user-local time (scheduler hits this once; we filter by profile flag).
//
// Auth: same CRON_SECRET header convention as the other cron routes.
// Idempotency: a per-user weekly_digests row keyed on (user_id, week_start)
// blocks double-sends if the cron fires twice on the same Sunday.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 500;

type ProfileRow = {
  id: string;
  mobile_e164: string | null;
  weekly_digest_enabled: boolean | null;
};

type Milestone = { text: string; done_at: string | null };

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function startOfWeek(d: Date): Date {
  // Sunday = 0; week_start = Monday of the same week (or last Mon if today is Sun).
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const dow = date.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  date.setDate(date.getDate() - offset);
  return date;
}

function gbp(cents: number): string {
  if (!cents) return "";
  const pounds = cents / 100;
  if (pounds >= 1000) return `£${(pounds / 1000).toFixed(pounds >= 10000 ? 0 : 1)}k`;
  return `£${pounds.toFixed(pounds % 1 === 0 ? 0 : 0)}`;
}

async function compose(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<string | null> {
  const startIso = weekStart.toISOString();
  const endIso = weekEnd.toISOString();
  const startYmd = ymd(weekStart);
  const endYmd = ymd(weekEnd);

  const [
    intentions,
    decisions,
    wins,
    goals,
    ideas,
    questions,
    checkins,
    reflections,
  ] = await Promise.all([
    admin
      .from("intentions")
      .select("log_date, text, completed_at")
      .eq("user_id", userId)
      .gte("log_date", startYmd)
      .lte("log_date", endYmd),
    admin
      .from("decisions")
      .select("id, title, reviewed_at, outcome_label")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("wins")
      .select("id, kind, amount_cents")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("goals")
      .select("id, title, status, progress_pct, milestones, updated_at")
      .eq("user_id", userId)
      .gte("updated_at", startIso),
    admin
      .from("ideas")
      .select("id, status, created_at, updated_at")
      .eq("user_id", userId)
      .gte("updated_at", startIso),
    admin
      .from("questions")
      .select("id, status, answered_at, created_at")
      .eq("user_id", userId)
      .or(`created_at.gte.${startIso},answered_at.gte.${startIso}`),
    admin
      .from("daily_checkins")
      .select("log_date, energy, mood, focus")
      .eq("user_id", userId)
      .gte("log_date", startYmd)
      .lte("log_date", endYmd),
    admin
      .from("reflections")
      .select("id, kind, text, created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false }),
  ]);

  const intentionRows = (intentions.data ?? []) as Array<{ log_date: string; text: string; completed_at: string | null }>;
  const decisionRows = (decisions.data ?? []) as Array<{ id: string; title: string; reviewed_at: string | null; outcome_label: string | null }>;
  const winRows = (wins.data ?? []) as Array<{ id: string; kind: string; amount_cents: number | null }>;
  const goalRows = (goals.data ?? []) as Array<{ id: string; title: string; status: string; progress_pct: number; milestones: Milestone[]; updated_at: string }>;
  const ideaRows = (ideas.data ?? []) as Array<{ id: string; status: string; created_at: string; updated_at: string }>;
  const questionRows = (questions.data ?? []) as Array<{ id: string; status: string; answered_at: string | null; created_at: string }>;
  const checkinRows = (checkins.data ?? []) as Array<{ log_date: string; energy: number; mood: number; focus: number }>;
  const reflectionRows = (reflections.data ?? []) as Array<{ id: string; kind: string; text: string; created_at: string }>;

  const intentionsSet = intentionRows.length;
  const intentionsDone = intentionRows.filter((r) => r.completed_at).length;

  const decisionsLogged = decisionRows.length;
  const decisionsReviewed = decisionRows.filter((r) => r.reviewed_at).length;

  const winsByKind: Record<string, number> = {};
  let winsAmount = 0;
  for (const w of winRows) {
    winsByKind[w.kind] = (winsByKind[w.kind] ?? 0) + 1;
    if (w.amount_cents) winsAmount += w.amount_cents;
  }
  const winsTotal = winRows.length;

  const goalsCompleted = goalRows.filter((g) => g.status === "done" && new Date(g.updated_at) >= weekStart).length;
  const milestonesCompleted = goalRows.reduce((acc, g) => {
    return acc + g.milestones.filter((m) => m.done_at && new Date(m.done_at) >= weekStart && new Date(m.done_at) <= weekEnd).length;
  }, 0);

  const ideasCaptured = ideaRows.filter((i) => new Date(i.created_at) >= weekStart).length;
  const ideasAdopted = ideaRows.filter((i) => i.status === "adopted" && new Date(i.updated_at) >= weekStart).length;

  const questionsAsked = questionRows.filter((q) => new Date(q.created_at) >= weekStart).length;
  const questionsAnswered = questionRows.filter((q) => q.answered_at && new Date(q.answered_at) >= weekStart).length;

  let avgEnergy: number | null = null;
  let avgMood: number | null = null;
  let avgFocus: number | null = null;
  if (checkinRows.length > 0) {
    const sum = checkinRows.reduce(
      (acc, r) => ({ e: acc.e + r.energy, m: acc.m + r.mood, f: acc.f + r.focus }),
      { e: 0, m: 0, f: 0 },
    );
    avgEnergy = +(sum.e / checkinRows.length).toFixed(1);
    avgMood = +(sum.m / checkinRows.length).toFixed(1);
    avgFocus = +(sum.f / checkinRows.length).toFixed(1);
  }

  const totalActivity =
    intentionsSet + decisionsLogged + winsTotal + milestonesCompleted +
    ideasCaptured + questionsAsked + questionsAnswered + checkinRows.length +
    reflectionRows.length;
  if (totalActivity === 0) return null;

  const lines: string[] = [];
  lines.push("Weekly wrap-up — your past 7 days at a glance.");
  lines.push("");

  if (winsTotal > 0) {
    const breakdown = Object.entries(winsByKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    const moneyBit = winsAmount > 0 ? ` · ${gbp(winsAmount)}` : "";
    lines.push(`Wins: ${winsTotal} (${breakdown})${moneyBit}`);
  }

  if (intentionsSet > 0) {
    lines.push(`Intentions: ${intentionsDone}/${intentionsSet} hit`);
  }

  if (milestonesCompleted > 0 || goalsCompleted > 0) {
    const parts: string[] = [];
    if (goalsCompleted > 0) parts.push(`${goalsCompleted} goal${goalsCompleted === 1 ? "" : "s"} closed`);
    if (milestonesCompleted > 0) parts.push(`${milestonesCompleted} milestone${milestonesCompleted === 1 ? "" : "s"} ticked`);
    lines.push(`Goals: ${parts.join(", ")}`);
  }

  if (decisionsLogged > 0 || decisionsReviewed > 0) {
    const parts: string[] = [];
    if (decisionsLogged > 0) parts.push(`${decisionsLogged} logged`);
    if (decisionsReviewed > 0) parts.push(`${decisionsReviewed} reviewed`);
    lines.push(`Decisions: ${parts.join(", ")}`);
  }

  if (ideasCaptured > 0 || ideasAdopted > 0) {
    const parts: string[] = [];
    if (ideasCaptured > 0) parts.push(`${ideasCaptured} captured`);
    if (ideasAdopted > 0) parts.push(`${ideasAdopted} adopted`);
    lines.push(`Ideas: ${parts.join(", ")}`);
  }

  if (questionsAsked > 0 || questionsAnswered > 0) {
    const parts: string[] = [];
    if (questionsAsked > 0) parts.push(`${questionsAsked} new`);
    if (questionsAnswered > 0) parts.push(`${questionsAnswered} answered`);
    lines.push(`Questions: ${parts.join(", ")}`);
  }

  if (avgEnergy != null && avgMood != null && avgFocus != null) {
    lines.push(`Check-ins (${checkinRows.length}/7d): energy ${avgEnergy} · mood ${avgMood} · focus ${avgFocus}`);
  }

  if (reflectionRows.length > 0) {
    const lessonsAndRealisations = reflectionRows.filter((r) => r.kind === "lesson" || r.kind === "realisation");
    if (lessonsAndRealisations.length > 0) {
      lines.push("");
      lines.push(`Lessons kept (${lessonsAndRealisations.length}):`);
      for (const r of lessonsAndRealisations.slice(0, 3)) {
        const snip = r.text.replace(/\s+/g, " ").slice(0, 140);
        lines.push(`• ${snip}${r.text.length > 140 ? "…" : ""}`);
      }
    } else {
      lines.push(`Reflections: ${reflectionRows.length} kept`);
    }
  }

  lines.push("");
  lines.push("Want a fuller weekly review? Just say the word.");

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  return checkAndRun(req);
}

export async function GET(req: NextRequest) {
  return checkAndRun(req);
}

async function checkAndRun(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return handle();
}

async function handle() {
  const admin = supabaseAdmin();
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekStartYmd = ymd(weekStart);

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, mobile_e164, weekly_digest_enabled")
    .eq("weekly_digest_enabled", true)
    .not("mobile_e164", "is", null)
    .limit(BATCH_LIMIT);
  if (error) {
    console.error("[cron/run-weekly-digest] profile query failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ user_id: string; status: string; error?: string }> = [];

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    try {
      const { data: existing } = await admin
        .from("weekly_digests")
        .select("id")
        .eq("user_id", profile.id)
        .eq("week_start", weekStartYmd)
        .maybeSingle();
      if (existing) {
        results.push({ user_id: profile.id, status: "skipped_already_sent" });
        continue;
      }

      const body = await compose(admin, profile.id, weekStart, weekEnd);
      if (!body) {
        results.push({ user_id: profile.id, status: "skipped_no_activity" });
        continue;
      }

      const { data: notif, error: insErr } = await admin
        .from("notifications")
        .insert({
          user_id: profile.id,
          channel: "whatsapp",
          to_e164: profile.mobile_e164,
          body,
          status: "queued",
        })
        .select("id")
        .single();
      if (insErr || !notif) {
        results.push({ user_id: profile.id, status: "failed", error: insErr?.message ?? "no row" });
        continue;
      }

      void dispatchNotification(admin, notif.id).catch((e) => {
        console.warn(`[cron/run-weekly-digest] dispatch failed for ${notif.id}:`, e);
      });

      await admin
        .from("weekly_digests")
        .insert({ user_id: profile.id, week_start: weekStartYmd, sent_at: new Date().toISOString() });

      results.push({ user_id: profile.id, status: "queued" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-weekly-digest] error for ${profile.id}:`, msg);
      results.push({ user_id: profile.id, status: "error", error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    week_start: weekStartYmd,
    scanned: profiles?.length ?? 0,
    sent: results.filter((r) => r.status === "queued").length,
    results,
  });
}
