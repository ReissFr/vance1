// Slack Events API webhook — handles @JARVIS mentions in channels and DMs
// to the bot. Same auth + user-resolution pattern as the slash command.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifySlackSignature } from "@/lib/slack-verify";
import { runBrainForMessage } from "@/lib/brain-run";
import { reportError } from "@/lib/error-report";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SlackEventWrapper {
  type: "url_verification" | "event_callback";
  challenge?: string;
  team_id?: string;
  api_app_id?: string;
  event?: SlackEvent;
}

interface SlackEvent {
  type: string;
  channel_type?: "im" | "channel" | "group" | "mpim";
  text?: string;
  user?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return new NextResponse("slack not configured", { status: 500 });
  }

  const ok = verifySlackSignature(
    signingSecret,
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!ok) return new NextResponse("bad signature", { status: 403 });

  let payload: SlackEventWrapper;
  try {
    payload = JSON.parse(rawBody) as SlackEventWrapper;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback" || !payload.event || !payload.team_id) {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;

  // Ignore bot-authored messages (including our own) and edited/deleted events.
  if (event.bot_id || event.subtype) return NextResponse.json({ ok: true });

  const isRelevant =
    event.type === "app_mention" ||
    (event.type === "message" && event.channel_type === "im");
  if (!isRelevant) return NextResponse.json({ ok: true });

  const teamId = payload.team_id;
  const slackUserId = event.user ?? "";
  const channel = event.channel ?? "";
  const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
  const threadTs = event.thread_ts ?? event.ts;

  if (!text || !slackUserId) return NextResponse.json({ ok: true });

  // Ack immediately; process async.
  void processMention({ teamId, slackUserId, channel, text, threadTs });

  return NextResponse.json({ ok: true });
}

interface ProcessMentionInput {
  teamId: string;
  slackUserId: string;
  channel: string;
  text: string;
  threadTs?: string;
}

async function processMention(input: ProcessMentionInput): Promise<void> {
  const admin = supabaseAdmin();

  const { data: rows } = await admin
    .from("integrations")
    .select("user_id, credentials")
    .eq("kind", "messaging")
    .eq("provider", "slack");
  const match = (rows ?? []).find((r) => {
    const c = (r as { credentials: Record<string, unknown> | null }).credentials ?? {};
    return (c as { team_id?: string }).team_id === input.teamId &&
      (c as { authed_user_id?: string }).authed_user_id === input.slackUserId;
  }) as { user_id: string; credentials: Record<string, unknown> } | undefined;

  if (!match) return; // Unknown user — silent ignore (don't DM random workspace members).

  const botToken = (match.credentials as { bot_token?: string }).bot_token;
  if (!botToken) return;

  const t0 = Date.now();
  try {
    const result = await runBrainForMessage({
      admin,
      userId: match.user_id,
      message: input.text,
      deviceKind: "web",
    });
    const ms = Date.now() - t0;

    await postSlackMessage(botToken, {
      channel: input.channel,
      text: result.text || "_(no reply)_",
      thread_ts: input.threadTs,
    });

    await trackEvent("slack_mention", {
      userId: match.user_id,
      properties: { chars_in: input.text.length, chars_out: result.text.length, ms },
      source: "server",
    });
  } catch (err) {
    await reportError(err, {
      route: "/api/slack/events",
      userId: match.user_id,
      context: { teamId: input.teamId, channel: input.channel, text: input.text },
    });
    await postSlackMessage(botToken, {
      channel: input.channel,
      text: "Something went wrong on my end. Try again in a moment.",
      thread_ts: input.threadTs,
    });
  }
}

async function postSlackMessage(
  botToken: string,
  payload: { channel: string; text: string; thread_ts?: string },
): Promise<void> {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // swallow
  }
}
