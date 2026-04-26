// Telegram Bot webhook. One shared JARVIS bot; users link via /start <code>.
//
// Auth: Telegram supports a secret token sent in the x-telegram-bot-api-secret-token
// header (set via setWebhook). We verify it against TELEGRAM_WEBHOOK_SECRET.
//
// Handlers:
//   /start [code]  — link (with code) or instruct to /link (without)
//   /unlink        — removes the telegram integration row
//   <anything else> — route to the linked user's brain

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runBrainForMessage } from "@/lib/brain-run";
import { upsertIntegration } from "@/lib/integrations-upsert";
import { sendTelegramMessage, sendTypingAction } from "@/lib/telegram";
import { reportError } from "@/lib/error-report";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  date: number;
  text?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) return new NextResponse("bad secret", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message ?? update.edited_message;
  if (!msg || !msg.text) return NextResponse.json({ ok: true });

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    await handleStart(chatId, text, msg);
    return NextResponse.json({ ok: true });
  }

  if (text === "/unlink") {
    await handleUnlink(chatId);
    return NextResponse.json({ ok: true });
  }

  if (text === "/help") {
    await sendTelegramMessage({
      chatId,
      text:
        "I'm JARVIS. Link your account with /start <code> (get the code from jarvis.yourdomain.com → Integrations), then just message me.\n\n/unlink — remove this link\n/help — this message",
    });
    return NextResponse.json({ ok: true });
  }

  // Route to brain.
  void processMessage({ chatId, text, replyToMessageId: msg.message_id });
  return NextResponse.json({ ok: true });
}

async function handleStart(
  chatId: number,
  text: string,
  msg: TelegramMessage,
): Promise<void> {
  const parts = text.split(/\s+/);
  const code = parts[1]?.toUpperCase();

  if (!code) {
    await sendTelegramMessage({
      chatId,
      text:
        "Welcome. To link this Telegram chat to your JARVIS account, open the web app → Integrations → Telegram → copy the code and send /start <code>.",
    });
    return;
  }

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("telegram_link_codes")
    .select("user_id, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    await sendTelegramMessage({
      chatId,
      text:
        "That code isn't valid or has expired. Get a fresh one from the JARVIS web app → Integrations → Telegram.",
    });
    return;
  }

  const userId = row.user_id as string;

  try {
    await upsertIntegration(admin, {
      userId,
      kind: "messaging",
      provider: "telegram",
      credentials: {
        chat_id: chatId,
        telegram_user_id: msg.from?.id ?? null,
        telegram_username: msg.from?.username ?? null,
      },
      scopes: [],
      metadata: {
        first_name: msg.from?.first_name ?? null,
        linked_at: new Date().toISOString(),
      },
    });

    await admin
      .from("telegram_link_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code", code);

    await trackEvent("telegram_linked", { userId, source: "server" });

    await sendTelegramMessage({
      chatId,
      text:
        "Linked. Message me anything and I'll reply here.",
    });
  } catch (err) {
    await reportError(err, {
      route: "/api/telegram/webhook",
      context: { phase: "link", code, chatId },
    });
    await sendTelegramMessage({
      chatId,
      text: "Couldn't complete the link. Try again in a moment.",
    });
  }
}

async function handleUnlink(chatId: number): Promise<void> {
  const admin = supabaseAdmin();
  const { data: rows } = await admin
    .from("integrations")
    .select("id, user_id, credentials")
    .eq("kind", "messaging")
    .eq("provider", "telegram");
  const match = (rows ?? []).find(
    (r) => (r as { credentials: { chat_id?: number } }).credentials?.chat_id === chatId,
  );
  if (!match) {
    await sendTelegramMessage({ chatId, text: "This chat isn't linked to any JARVIS account." });
    return;
  }
  await admin.from("integrations").delete().eq("id", (match as { id: string }).id);
  await sendTelegramMessage({ chatId, text: "Unlinked. Send /start <code> to re-link." });
}

async function processMessage(input: {
  chatId: number;
  text: string;
  replyToMessageId: number;
}): Promise<void> {
  const admin = supabaseAdmin();

  const { data: rows } = await admin
    .from("integrations")
    .select("user_id, credentials")
    .eq("kind", "messaging")
    .eq("provider", "telegram");
  const match = (rows ?? []).find(
    (r) =>
      (r as { credentials: { chat_id?: number } }).credentials?.chat_id ===
      input.chatId,
  ) as { user_id: string } | undefined;

  if (!match) {
    await sendTelegramMessage({
      chatId: input.chatId,
      text:
        "This chat isn't linked yet. Get a code from the JARVIS web app → Integrations → Telegram and send /start <code>.",
    });
    return;
  }

  await sendTypingAction(input.chatId);
  const t0 = Date.now();
  try {
    const result = await runBrainForMessage({
      admin,
      userId: match.user_id,
      message: input.text,
      deviceKind: "web",
    });
    const ms = Date.now() - t0;

    await sendTelegramMessage({
      chatId: input.chatId,
      text: result.text || "_(no reply)_",
      replyToMessageId: input.replyToMessageId,
    });

    await trackEvent("telegram_message", {
      userId: match.user_id,
      properties: { chars_in: input.text.length, chars_out: result.text.length, ms },
      source: "server",
    });
  } catch (err) {
    await reportError(err, {
      route: "/api/telegram/webhook",
      userId: match.user_id,
      context: { phase: "brain", text: input.text },
    });
    await sendTelegramMessage({
      chatId: input.chatId,
      text: "Something went wrong on my end. Try again in a moment.",
      replyToMessageId: input.replyToMessageId,
    });
  }
}
