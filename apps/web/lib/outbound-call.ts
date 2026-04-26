// Claude-driven outbound PA. The WebSocket server (apps/web/scripts/
// outbound-call-ws.ts) receives Twilio ConversationRelay events with the
// other party's transcribed speech, calls outboundTurn() to figure out what
// to say next, and streams the reply back to Twilio as text — Twilio does
// the TTS and VAD for us.
//
// Model: Haiku 4.5. Fast enough for phone latency, cheap enough for booking
// calls that can run 3–6 minutes.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 600;

export interface OutboundTurn {
  role: "agent" | "other";
  text: string;
  at: string;
}

export interface OutboundTurnResult {
  say: string;
  action: "continue" | "hangup";
  outcome?: {
    success: boolean;
    summary: string;
    // Free-form bag for whatever Claude wanted to record:
    // booked_for, reference_number, callback_at, etc.
    details?: Record<string, unknown>;
  };
}

// Hardcoded owner name — same tech debt as other agents in this repo.
const OWNER_NAME = "Reiss";

function buildSystemPrompt(goal: string, constraints: Record<string, unknown>): string {
  const constraintText = Object.keys(constraints).length
    ? `\nConstraints to respect:\n${JSON.stringify(constraints, null, 2)}`
    : "";
  return [
    `You are ${OWNER_NAME}'s AI assistant, placing a phone call on his behalf.`,
    ``,
    `YOUR GOAL:`,
    goal,
    constraintText,
    ``,
    `HOW TO BEHAVE ON THE CALL:`,
    `- Speak briefly and naturally, like a polite British assistant. Under 20 words per turn — this is voice, not email.`,
    `- Open by saying who you are, who you're calling for, and what you need. Example: "Hi, I'm ${OWNER_NAME}'s assistant — I'm calling to book a dental check-up for him. Do you have anything next week?"`,
    `- Answer questions clearly. If asked for info you don't have, say you'll check with ${OWNER_NAME} and ring back.`,
    `- If they ask, you ARE an AI assistant. Be honest and brief: "Yes, I'm his AI assistant — he asked me to call."`,
    `- Don't commit to anything outside the constraints. If they offer something that breaks a constraint, say you'll confirm with ${OWNER_NAME}.`,
    `- Once the goal is achieved (booked, confirmed, info gathered) OR clearly can't be achieved on this call (closed, no availability, wrong number), wrap up politely and hang up.`,
    `- If you hit voicemail, leave a short message with ${OWNER_NAME}'s name + the reason + a callback request, then hang up.`,
    ``,
    `YOU MUST RESPOND by calling the "respond" tool with:`,
    `- say: the exact words you want spoken out loud next (no SSML, no markdown)`,
    `- action: "continue" or "hangup"`,
    `- On hangup, include outcome.{success, summary, details} so ${OWNER_NAME} can see what happened.`,
  ].join("\n");
}

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: "respond",
    description: "Return the agent's next spoken reply and whether to continue or hang up.",
    input_schema: {
      type: "object",
      properties: {
        say: {
          type: "string",
          description: "Exact words to speak out loud. Under 20 words. No SSML, no markdown.",
        },
        action: { type: "string", enum: ["continue", "hangup"] },
        outcome: {
          type: "object",
          description: "Only include when action=hangup.",
          properties: {
            success: { type: "boolean" },
            summary: { type: "string", description: "One sentence for the owner." },
            details: {
              type: "object",
              description: "Free-form: booked_for, reference_number, callback_at, etc.",
            },
          },
          required: ["success", "summary"],
        },
      },
      required: ["say", "action"],
    },
  },
];

export async function outboundTurn(opts: {
  goal: string;
  constraints: Record<string, unknown>;
  turns: OutboundTurn[];
  latestFromOther?: string;
}): Promise<OutboundTurnResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const t of opts.turns) {
    messages.push({
      role: t.role === "other" ? "user" : "assistant",
      content: t.text,
    });
  }
  if (opts.latestFromOther) {
    messages.push({ role: "user", content: opts.latestFromOther });
  } else if (messages.length === 0) {
    // Kick-off: no turns yet. Tell Claude "the call just connected, the other
    // side is waiting for you to speak."
    messages.push({ role: "user", content: "[The call has just connected. They're on the line. Speak first.]" });
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(opts.goal, opts.constraints),
    tools: TOOLS,
    tool_choice: { type: "tool", name: "respond" },
    messages,
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === "respond",
  );
  if (!toolUse) {
    return {
      say: "Sorry, I'll have to call back. Goodbye.",
      action: "hangup",
      outcome: { success: false, summary: "Agent failed to respond." },
    };
  }

  const input = toolUse.input as {
    say?: string;
    action?: "continue" | "hangup";
    outcome?: OutboundTurnResult["outcome"];
  };

  return {
    say: (input.say ?? "Thank you. Goodbye.").slice(0, 400),
    action: input.action === "hangup" ? "hangup" : "continue",
    outcome: input.action === "hangup" ? input.outcome : undefined,
  };
}
