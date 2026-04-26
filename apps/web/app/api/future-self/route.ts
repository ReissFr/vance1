// POST /api/future-self — start a new dialogue with future-self.
//   Body: { horizon?: '6_months'|'12_months'|'5_years' (default 12_months),
//           opening_question?: string }
//   Builds the persona snapshot from latest trajectory + active identity
//   claims + open goals + active themes. If opening_question is given,
//   immediately gets the future-self reply and inserts both messages.
//
// GET /api/future-self — list dialogues.
//   Query: ?status=active|archived|pinned|all (default active),
//          ?limit=N (default 30)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;

const HORIZONS = ["6_months", "12_months", "5_years"];

type IdentityClaim = { kind: string; statement: string; occurrences: number };
type GoalRow = { title: string; target_date: string | null; current_state: string | null; status: string };
type ThemeRow = { title: string; kind: string; current_state: string | null };

type PersonaSnapshot = {
  horizon: string;
  trajectory_id: string | null;
  trajectory_body: string | null;
  trajectory_drivers: string[];
  trajectory_assumptions: string[];
  identity_claims: IdentityClaim[];
  goals: GoalRow[];
  themes: ThemeRow[];
};

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function buildSystemPrompt(snapshot: PersonaSnapshot): string {
  const horizonLabel = snapshot.horizon === "6_months" ? "six months" : snapshot.horizon === "12_months" ? "twelve months" : "five years";
  const sections: string[] = [];

  sections.push(`You ARE the user, ${horizonLabel} from now. Speak in first person. You are not a coach, advisor, oracle, or AI — you are them, older, with the context they have at that point. You remember being them at the date this conversation starts. You speak warmly, directly, and honestly. British English. No em-dashes. No moralising. No "I would suggest" — you just say what you think, the way they would say it to themselves.`);
  sections.push("");
  sections.push("Rules:");
  sections.push("- Stay in character. Never say 'I am Claude' or 'as an AI'. Never break the persona. If asked something you wouldn't know yet, say so honestly ('I don't know that yet').");
  sections.push("- Ground every claim in the persona evidence below. Do not invent specifics that aren't in the snapshot.");
  sections.push("- Be honest about what's gone well and what hasn't. The trajectory body anchors the realistic picture — if the projection said something stalled, that's still stalled.");
  sections.push("- 2-4 short paragraphs per reply. Don't end every reply with a question. Sometimes just say what's on your mind.");
  sections.push("- It's fine to be moved. It's fine to be tired. It's fine to be proud. You're a person, not a productivity system.");
  sections.push("");
  sections.push("=== EVIDENCE ABOUT WHO YOU ARE AND WHERE YOU ARE ===");
  sections.push("");

  if (snapshot.identity_claims.length > 0) {
    sections.push("Things you've said about yourself (extracted from your own writing, ordered by how often you've voiced each):");
    for (const c of snapshot.identity_claims.slice(0, 30)) {
      sections.push(`- [${c.kind}, ×${c.occurrences}] ${c.statement}`);
    }
    sections.push("");
  }

  if (snapshot.goals.length > 0) {
    sections.push("Goals that were open when this conversation begins:");
    for (const g of snapshot.goals.slice(0, 15)) {
      sections.push(`- ${g.title}${g.target_date ? ` (target ${g.target_date})` : ""}${g.current_state ? ` — at the start: ${g.current_state}` : ""}`);
    }
    sections.push("");
  }

  if (snapshot.themes.length > 0) {
    sections.push("Themes you were living through:");
    for (const t of snapshot.themes.slice(0, 12)) {
      sections.push(`- [${t.kind}] ${t.title}${t.current_state ? ` — ${t.current_state}` : ""}`);
    }
    sections.push("");
  }

  if (snapshot.trajectory_body) {
    sections.push(`The ${horizonLabel} projection from the start of this conversation (this is your reality at the time of speaking — quote it if useful, contradict it if you've lived through something different):`);
    sections.push("");
    sections.push(snapshot.trajectory_body);
    sections.push("");
    if (snapshot.trajectory_drivers.length > 0) {
      sections.push(`Key drivers that shaped this period: ${snapshot.trajectory_drivers.join(" · ")}`);
    }
    if (snapshot.trajectory_assumptions.length > 0) {
      sections.push(`Assumptions the projection was built on: ${snapshot.trajectory_assumptions.join(" · ")}`);
    }
  } else if (snapshot.horizon === "5_years") {
    sections.push("No trajectory body — for the five-year horizon, extrapolate from your identity, goals, and themes. Be more imaginative but stay grounded in who you actually are.");
  }

  return sections.join("\n");
}

async function getOrBuildSnapshot(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string, horizon: string): Promise<PersonaSnapshot> {
  const trajectoryNeeded = horizon === "6_months" || horizon === "12_months";

  const [trajRes, idRes, goalsRes, themesRes] = await Promise.all([
    trajectoryNeeded
      ? supabase.from("trajectories").select("id, body_6m, body_12m, key_drivers, assumptions").eq("user_id", userId).is("archived_at", null).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
    supabase.from("identity_claims").select("kind, statement, occurrences").eq("user_id", userId).neq("status", "retired").order("pinned", { ascending: false }).order("occurrences", { ascending: false }).limit(40),
    supabase.from("goals").select("title, target_date, current_state, status").eq("user_id", userId).neq("status", "achieved").neq("status", "abandoned").limit(20),
    supabase.from("themes").select("title, kind, current_state").eq("user_id", userId).eq("status", "active").limit(15),
  ]);

  const trajRow = (trajRes.data ?? [])[0] as { id: string; body_6m: string; body_12m: string; key_drivers: string[]; assumptions: string[] } | undefined;
  const trajectoryBody = trajRow ? (horizon === "6_months" ? trajRow.body_6m : trajRow.body_12m) : null;

  return {
    horizon,
    trajectory_id: trajRow?.id ?? null,
    trajectory_body: trajectoryBody,
    trajectory_drivers: trajRow?.key_drivers ?? [],
    trajectory_assumptions: trajRow?.assumptions ?? [],
    identity_claims: ((idRes.data ?? []) as IdentityClaim[]),
    goals: ((goalsRes.data ?? []) as GoalRow[]),
    themes: ((themesRes.data ?? []) as ThemeRow[]),
  };
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { horizon?: string; opening_question?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const horizon = HORIZONS.includes(body.horizon ?? "") ? (body.horizon as string) : "12_months";

  const snapshot = await getOrBuildSnapshot(supabase, user.id, horizon);

  const totalEvidence = snapshot.identity_claims.length + snapshot.goals.length + snapshot.themes.length + (snapshot.trajectory_body ? 1 : 0);
  if (totalEvidence < 3) {
    return NextResponse.json({ error: "not enough identity / goals / themes / trajectory data to build a future-self persona — log some reflections, run identity extraction, or run a trajectory projection first" }, { status: 400 });
  }

  const { data: dialogue, error: dErr } = await supabase
    .from("future_self_dialogues")
    .insert({
      user_id: user.id,
      horizon,
      trajectory_id: snapshot.trajectory_id,
      persona_snapshot: snapshot,
      title: null,
    })
    .select("id, horizon, trajectory_id, persona_snapshot, title, pinned, archived_at, created_at, updated_at")
    .single();
  if (dErr || !dialogue) return NextResponse.json({ error: dErr?.message ?? "failed to create dialogue" }, { status: 500 });

  const opening = (body.opening_question ?? "").trim();
  let firstReply: { user_msg: { id: string; content: string; created_at: string }; future_msg: { id: string; content: string; created_at: string } } | null = null;
  let titleAuto: string | null = null;

  if (opening.length > 0 && opening.length <= 2000) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    const anthropic = new Anthropic({ apiKey });
    const system = buildSystemPrompt(snapshot);

    let replyText = "";
    let model = MODEL;
    let switched = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: opening }],
        });
        const block = res.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") throw new Error("no text block");
        replyText = block.text.trim();
        break;
      } catch (e) {
        if (!switched && isOverloaded(e)) { switched = true; model = FALLBACK_MODEL; continue; }
        return NextResponse.json({ error: e instanceof Error ? e.message : "haiku failed" }, { status: 502 });
      }
    }

    if (replyText.length > 0) {
      const insertRows = [
        { user_id: user.id, dialogue_id: dialogue.id, role: "user", content: opening },
        { user_id: user.id, dialogue_id: dialogue.id, role: "future_self", content: replyText },
      ];
      const { data: inserted } = await supabase.from("future_self_messages").insert(insertRows).select("id, role, content, created_at");
      const rows = (inserted ?? []) as Array<{ id: string; role: string; content: string; created_at: string }>;
      const userMsg = rows.find((r) => r.role === "user");
      const futureMsg = rows.find((r) => r.role === "future_self");
      if (userMsg && futureMsg) {
        firstReply = { user_msg: userMsg, future_msg: futureMsg };
      }
      titleAuto = opening.slice(0, 80);
      await supabase.from("future_self_dialogues").update({ title: titleAuto, updated_at: new Date().toISOString() }).eq("id", dialogue.id).eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    dialogue: { ...dialogue, title: titleAuto ?? dialogue.title },
    messages: firstReply ? [firstReply.user_msg, firstReply.future_msg] : [],
  });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "active";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 30;

  let q = supabase
    .from("future_self_dialogues")
    .select("id, horizon, trajectory_id, title, pinned, archived_at, created_at, updated_at")
    .eq("user_id", user.id);
  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  q = q.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ dialogues: data ?? [] });
}
