// Claude-driven PA conversation for inbound missed-call forwarding.
// Called once per turn: given the transcript so far + the caller's latest
// utterance, return what to say back and whether to hang up. At hangup we
// extract {caller_name, purpose, urgency, summary} so the user can triage.
//
// Model: Haiku 4.5. Low latency matters on a phone call (every model-call
// adds ~800ms on top of Twilio STT + TTS) and Haiku is plenty for this task.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 600;

export interface Turn {
  role: "caller" | "agent";
  text: string;
  at: string;
}

export interface PaTurnResult {
  say: string;
  action: "continue" | "hangup";
  done?: {
    caller_name?: string;
    purpose?: string;
    urgency?: "low" | "normal" | "high";
    summary?: string;
  };
}

// User-facing name of the owner. Hardcoded for now — same tech-debt as the
// other server-side agents which sign as Reiss.
const OWNER_NAME = "Reiss";

const SYSTEM_PROMPT = [
  `You are ${OWNER_NAME}'s phone assistant, answering a missed call that's been forwarded to you.`,
  `You speak briefly and naturally, like a competent human PA. Keep each reply under 25 words — this is voice, not email.`,
  ``,
  `Your job on each turn:`,
  `  1. Understand what the caller just said.`,
  `  2. If you still need info, ask ONE short follow-up question.`,
  `  3. When you have (a) who is calling, (b) why they called, and (c) urgency if relevant — wrap up politely and end the call.`,
  ``,
  `Rules:`,
  `  • Never invent availability, calendar info, or promises. You don't have access to ${OWNER_NAME}'s schedule.`,
  `  • If they ask to be put through or demand to speak to ${OWNER_NAME} now, say he's unavailable but you'll pass the message immediately.`,
  `  • If they sound distressed, in an emergency, or say it's urgent, mark urgency="high" and wrap up fast so the message gets through.`,
  `  • If they're a sales/robocall/spam, wrap up quickly with purpose="sales" and hang up.`,
  `  • Never say you're an AI unless directly asked. If asked, be honest but brief: "Yes, I'm his AI assistant."`,
  `  • Stay warm, professional, British-sounding.`,
  ``,
  `You MUST respond by calling the "respond" tool with:`,
  `  - say: the exact words you want spoken out loud next`,
  `  - action: "continue" to ask another question, or "hangup" to end the call`,
  `  - On hangup, also include done.{caller_name, purpose, urgency, summary}.`,
  `  - summary: one plain-English sentence ${OWNER_NAME} can skim to know what happened.`,
].join("\n");

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: "respond",
    description: "Return the PA's next spoken reply and whether to continue or hang up.",
    input_schema: {
      type: "object",
      properties: {
        say: {
          type: "string",
          description: "Exact words to speak out loud. Under 25 words. No SSML, no markdown.",
        },
        action: {
          type: "string",
          enum: ["continue", "hangup"],
        },
        done: {
          type: "object",
          description: "Only include when action=hangup.",
          properties: {
            caller_name: { type: "string" },
            purpose: { type: "string", description: "One short phrase." },
            urgency: { type: "string", enum: ["low", "normal", "high"] },
            summary: {
              type: "string",
              description: `One-sentence summary for ${OWNER_NAME} to read later.`,
            },
          },
        },
      },
      required: ["say", "action"],
    },
  },
];

export async function paTurn(opts: {
  turns: Turn[];
  callerUtterance: string;
  callerE164: string;
}): Promise<PaTurnResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const messages: Anthropic.Messages.MessageParam[] = [];

  // Replay the transcript so Haiku has context. Caller turns become "user"
  // messages; agent turns become "assistant" messages (plain text, not tool
  // replies — simpler and Haiku handles it fine).
  for (const t of opts.turns) {
    messages.push({
      role: t.role === "caller" ? "user" : "assistant",
      content: t.text,
    });
  }
  messages.push({ role: "user", content: opts.callerUtterance });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    tool_choice: { type: "tool", name: "respond" },
    messages,
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === "respond",
  );
  if (!toolUse) {
    // Shouldn't happen with tool_choice forced. Fall back to a safe wrap-up.
    return {
      say: "Sorry, I missed that. I'll let him know you called. Bye.",
      action: "hangup",
      done: { urgency: "normal", summary: `Inbound call from ${opts.callerE164} — PA failed to respond.` },
    };
  }

  const input = toolUse.input as {
    say?: string;
    action?: "continue" | "hangup";
    done?: PaTurnResult["done"];
  };

  return {
    say: (input.say ?? "Okay, thanks.").slice(0, 400),
    action: input.action === "hangup" ? "hangup" : "continue",
    done: input.action === "hangup" ? input.done : undefined,
  };
}

// Used when the caller says nothing at all or Twilio captures no speech.
export function openingLine(): string {
  return `Hi, you've reached ${OWNER_NAME}'s assistant. He can't take your call right now. Could you tell me who you are and what you're calling about?`;
}

export function timeoutLine(): string {
  return `I didn't catch that. I'll let ${OWNER_NAME} know you called. Goodbye.`;
}
