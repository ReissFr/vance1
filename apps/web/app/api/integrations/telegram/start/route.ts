// Issues a one-shot link code the user pastes into Telegram:
//   /start <code>   (or opens t.me/<bot>?start=<code>)
// The bot's webhook consumes it and creates the integrations row.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

function makeCode(): string {
  // Short, unambiguous alphabet — no 0/O/1/I. 8 chars ≈ 10^11 space.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;

  const admin = supabaseAdmin();
  const code = makeCode();
  const { error } = await admin.from("telegram_link_codes").insert({
    code,
    user_id: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    code,
    deep_link: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
    instructions: botUsername
      ? `Open Telegram, send '/start ${code}' to @${botUsername}, or tap the link below.`
      : `Open the JARVIS bot in Telegram and send '/start ${code}'.`,
    expires_in_minutes: 15,
  });
}
