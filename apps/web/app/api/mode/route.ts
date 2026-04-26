// GET/POST /api/mode — JARVIS mode toggle (assistant | ceo).
//
// Reads/writes profiles.jarvis_mode. Brain reads the mode at the start of
// each turn and swaps in the appropriate system-prompt block.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set(["assistant", "ceo"]);

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("profiles")
    .select("jarvis_mode")
    .eq("id", user.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ mode: data?.jarvis_mode ?? "assistant" });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { mode?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const mode = String(body.mode ?? "").toLowerCase();
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "mode must be 'assistant' or 'ceo'" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ jarvis_mode: mode })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, mode });
}
