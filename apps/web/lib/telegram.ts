// Minimal Telegram Bot API helpers — no SDK. We only need sendMessage and
// typing indicator for the MVP brain-reply flow.

const API = "https://api.telegram.org";

export function telegramBotToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return t;
}

export async function sendTelegramMessage(opts: {
  chatId: number | string;
  text: string;
  replyToMessageId?: number;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
}): Promise<void> {
  const token = telegramBotToken();
  try {
    await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: opts.text,
        reply_to_message_id: opts.replyToMessageId,
        parse_mode: opts.parseMode,
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // Swallow — outbound Telegram failures shouldn't crash the webhook.
  }
}

export async function sendTypingAction(chatId: number | string): Promise<void> {
  const token = telegramBotToken();
  try {
    await fetch(`${API}/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {
    // swallow
  }
}
