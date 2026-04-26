// Slack /jarvis slash command webhook.
//
// Flow:
//   1. Verify HMAC signature using SLACK_SIGNING_SECRET.
//   2. Map (team_id, user_id) to a JARVIS user via the `integrations` table
//      (kind=messaging, provider=slack, credentials.authed_user_id match).
//   3. Immediately return an ephemeral "JARVIS is thinking…" ack (Slack
//      requires 200 within 3s).
//   4. Fire-and-forget the brain run; when it completes, POST the final
//      reply back to Slack via response_url.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifySlackSignature } from "@/lib/slack-verify";
import { runBrainForMessage } from "@/lib/brain-run";
import { reportError } from "@/lib/error-report";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    await reportError(new Error("SLACK_SIGNING_SECRET not set"), {
      route: "/api/slack/command",
      severity: "warn",
    });
    return new NextResponse("slack not configured", { status: 500 });
  }

  const ok = verifySlackSignature(
    signingSecret,
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!ok) return new NextResponse("bad signature", { status: 403 });

  const form = new URLSearchParams(rawBody);
  const teamId = form.get("team_id") ?? "";
  const slackUserId = form.get("user_id") ?? "";
  const text = (form.get("text") ?? "").trim();
  const responseUrl = form.get("response_url") ?? "";
  const channelId = form.get("channel_id") ?? "";

  if (!text) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Give me something to do. e.g. `/jarvis what's on my calendar today?`",
    });
  }

  const admin = supabaseAdmin();
  const jarvisUserId = await resolveJarvisUser(admin, teamId, slackUserId);
  if (!jarvisUserId) {
    return NextResponse.json({
      response_type: "ephemeral",
      text:
        "I don't recognise this Slack workspace yet. Connect JARVIS to Slack at your dashboard → Integrations, then try again.",
    });
  }

  // Fire async. We return the ephemeral ack immediately below.
  void processAndReply({
    jarvisUserId,
    text,
    responseUrl,
    teamId,
    channelId,
    slackUserId,
  });

  return NextResponse.json({
    response_type: "ephemeral",
    text: "_JARVIS is thinking…_",
  });
}

async function resolveJarvisUser(
  admin: ReturnType<typeof supabaseAdmin>,
  teamId: string,
  slackUserId: string,
): Promise<string | null> {
  if (!teamId || !slackUserId) return null;
  const { data } = await admin
    .from("integrations")
    .select("user_id, credentials")
    .eq("kind", "messaging")
    .eq("provider", "slack");
  const rows = (data ?? []) as Array<{
    user_id: string;
    credentials: Record<string, unknown> | null;
  }>;
  const match = rows.find((r) => {
    const c = r.credentials ?? {};
    return (c as { team_id?: string }).team_id === teamId &&
      (c as { authed_user_id?: string }).authed_user_id === slackUserId;
  });
  return match?.user_id ?? null;
}

interface ProcessInput {
  jarvisUserId: string;
  text: string;
  responseUrl: string;
  teamId: string;
  channelId: string;
  slackUserId: string;
}

async function processAndReply(input: ProcessInput): Promise<void> {
  const admin = supabaseAdmin();
  const t0 = Date.now();
  try {
    const result = await runBrainForMessage({
      admin,
      userId: input.jarvisUserId,
      message: input.text,
      deviceKind: "web",
    });
    const ms = Date.now() - t0;

    await trackEvent("slack_command", {
      userId: input.jarvisUserId,
      properties: {
        team_id: input.teamId,
        channel_id: input.channelId,
        chars_in: input.text.length,
        chars_out: result.text.length,
        ms,
      },
      source: "server",
    });

    await postToResponseUrl(input.responseUrl, {
      response_type: "in_channel",
      text: result.text || "_(no reply)_",
    });
  } catch (err) {
    await reportError(err, {
      route: "/api/slack/command",
      userId: input.jarvisUserId,
      context: { teamId: input.teamId, channelId: input.channelId, text: input.text },
    });
    await postToResponseUrl(input.responseUrl, {
      response_type: "ephemeral",
      text: "Something went wrong on my end. Try again in a moment.",
    });
  }
}

async function postToResponseUrl(
  url: string,
  payload: { response_type: "in_channel" | "ephemeral"; text: string },
): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Swallow — response_url failure shouldn't crash background handler.
  }
}
