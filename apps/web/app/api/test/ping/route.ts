// Tiny diagnostic route for the WhatsApp ping path. Hits the same
// notifications → dispatchNotification → Twilio chain the concierge's
// ping_user tool uses, but skips everything else. If this delivers, the
// plumbing is fine — any issue with concierge pings is in the concierge
// loop, not the notify infra.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { message?: string; email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const admin = supabaseAdmin();
  const secretHeader = req.headers.get("x-test-secret");
  const isSecretBypass =
    !!process.env.CRON_SECRET && secretHeader === process.env.CRON_SECRET;

  let userId: string;
  if (isSecretBypass) {
    if (!body.email) {
      return NextResponse.json(
        { ok: false, error: "secret bypass requires { email } in body" },
        { status: 400 },
      );
    }
    const { data: list, error: lErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (lErr) {
      return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 });
    }
    const match = list.users.find((u) => u.email === body.email);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: `no auth user for email ${body.email}` },
        { status: 404 },
      );
    }
    userId = match.id;
  } else {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    userId = user.id;
  }

  const message = (body.message ?? "JARVIS ping test — if you see this, WhatsApp works.").slice(0, 400);

  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) {
    return NextResponse.json(
      { ok: false, error: "no mobile_e164 on profile" },
      { status: 400 },
    );
  }

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body: message,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !notif) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), notification_id: notif.id },
      { status: 500 },
    );
  }

  const { data: after } = await admin
    .from("notifications")
    .select("status, provider_sid, error")
    .eq("id", notif.id)
    .single();

  return NextResponse.json({
    ok: true,
    notification_id: notif.id,
    to: profile.mobile_e164,
    status: after?.status,
    provider_sid: after?.provider_sid,
    error: after?.error,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST here (while logged in) — sends a test WhatsApp to the mobile_e164 on your profile.",
  });
}
