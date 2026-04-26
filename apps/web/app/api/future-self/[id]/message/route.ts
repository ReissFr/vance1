// POST /api/future-self/[id]/message — append a user message and get
// the future-self reply. Builds the conversation history from prior
// messages and re-uses the dialogue's persona_snapshot as the system
// prompt anchor.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;
const HISTORY_LIMIT = 40;

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
  sections.push(`You ARE the user, ${horizonLabel} from now. Speak in first person. You are not a coach, advisor, oracle, or AI — you are them, older, with the context they have at that point. You speak warmly, directly, and honestly. British English. No em-dashes. No moralising.`);
  sections.push("");
  sections.push("Rules:");
  sections.push("- Stay in character. Never say 'I am Claude' or 'as an AI'. Never break the persona. If asked something you wouldn't know yet, say so honestly.");
  sections.push("- Ground every claim in the persona evidence below.");
  sections.push("- 2-4 short paragraphs per reply. Don't end every reply with a question.");
  sections.push("- It's fine to be moved, tired, proud. You're a person, not a productivity system.");
  sections.push("");
  sections.push("=== EVIDENCE ABOUT WHO YOU ARE AND WHERE YOU ARE ===");
  sections.push("");

  if (snapshot.identity_claims.length > 0) {
    sections.push("Things you've said about yourself:");
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
    sections.push(`The ${horizonLabel} projection from the start of this conversation:`);
    sections.push("");
    sections.push(snapshot.trajectory_body);
    sections.push("");
    if (snapshot.trajectory_drivers.length > 0) {
      sections.push(`Key drivers: ${snapshot.trajectory_drivers.join(" · ")}`);
    }
  }

  return sections.join("\n");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: dialogueId } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { content?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const content = (body.content ?? "").trim();
  if (content.length < 1 || content.length > 4000) {
    return NextResponse.json({ error: "content must be 1-4000 chars" }, { status: 400 });
  }

  const { data: dialogue, error: dErr } = await supabase
    .from("future_self_dialogues")
    .select("id, horizon, persona_snapshot")
    .eq("id", dialogueId)
    .eq("user_id", user.id)
    .single();
  if (dErr || !dialogue) return NextResponse.json({ error: "dialogue not found" }, { status: 404 });

  const snapshot = (dialogue as { persona_snapshot: PersonaSnapshot }).persona_snapshot;

  const { data: history } = await supabase
    .from("future_self_messages")
    .select("role, content, created_at")
    .eq("dialogue_id", dialogueId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of (history ?? []) as Array<{ role: string; content: string }>) {
    messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  messages.push({ role: "user", content });

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
        messages,
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

  if (replyText.length === 0) return NextResponse.json({ error: "empty reply" }, { status: 502 });

  const inserts = [
    { user_id: user.id, dialogue_id: dialogueId, role: "user", content },
    { user_id: user.id, dialogue_id: dialogueId, role: "future_self", content: replyText },
  ];
  const { data: inserted, error: iErr } = await supabase
    .from("future_self_messages")
    .insert(inserts)
    .select("id, role, content, created_at");
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  await supabase.from("future_self_dialogues").update({ updated_at: new Date().toISOString() }).eq("id", dialogueId).eq("user_id", user.id);

  return NextResponse.json({ messages: inserted ?? [] });
}
