// Standalone WebSocket server that bridges Twilio ConversationRelay <->
// Claude for outbound PA calls.
//
// Vercel/Netlify serverless can't hold WebSockets open, so this runs as its
// own Node process:
//
//   PORT=3031 pnpm --filter web relay
//
// Expose the port to the public with ngrok (e.g. a second tunnel or the same
// one if your ngrok plan allows) and set CONVERSATION_RELAY_WS_URL to the
// resulting wss:// URL + "/relay" path. The outbound TwiML route hands that
// URL to Twilio.
//
// ConversationRelay protocol (https://www.twilio.com/docs/voice/twiml/connect/conversationrelay):
//   From Twilio:
//     {type:"setup", sessionId, callSid, from, to, ...}
//     {type:"prompt", voicePrompt, last}
//     {type:"interrupt", utteranceUntilInterrupt, ...}
//     {type:"dtmf", digit}
//     {type:"error", description}
//   To Twilio:
//     {type:"text", token, last}        // speak this (token=text, last=true to flush)
//     {type:"end"}                       // hang up
//     {type:"language", language, ttsLanguage}  // change language mid-call

import { WebSocketServer, type WebSocket } from "ws";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { outboundTurn, type OutboundTurn } from "../lib/outbound-call";

const PORT = Number(process.env.RELAY_PORT ?? process.env.PORT ?? 3031);

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const wss = new WebSocketServer({ port: PORT, path: "/relay" });

console.log(`[relay] listening on ws://0.0.0.0:${PORT}/relay`);

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const callId = url.searchParams.get("call_id");
  console.log(`[relay] connection opened, call_id=${callId}`);

  if (!callId) {
    ws.close(1008, "missing call_id");
    return;
  }

  handleCall(ws, callId).catch((e) => {
    console.error("[relay] handler crashed:", e);
    try { ws.close(1011, "internal error"); } catch { /* ignore */ }
  });
});

async function handleCall(ws: WebSocket, callId: string) {
  const { data: row, error } = await supabase
    .from("outbound_calls")
    .select("id, goal, constraints, turns")
    .eq("id", callId)
    .single();
  if (error || !row) {
    console.warn(`[relay] call ${callId} not found:`, error?.message);
    ws.close(1008, "call not found");
    return;
  }

  const goal: string = row.goal;
  const constraints: Record<string, unknown> = (row.constraints as Record<string, unknown>) ?? {};
  const turns: OutboundTurn[] = Array.isArray(row.turns) ? (row.turns as OutboundTurn[]) : [];

  // Kick off: take the first turn before hearing anything.
  let hasSpokenFirst = false;

  ws.on("message", async (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn("[relay] non-JSON message, ignoring");
      return;
    }

    try {
      if (msg.type === "setup") {
        console.log(`[relay] setup: callSid=${msg.callSid}`);
        // Stamp callSid + mark in_progress.
        await supabase
          .from("outbound_calls")
          .update({
            call_sid: String(msg.callSid ?? ""),
            status: "in_progress",
            started_at: new Date().toISOString(),
          })
          .eq("id", callId);

        // Speak first.
        if (!hasSpokenFirst) {
          hasSpokenFirst = true;
          await takeTurn(ws, callId, goal, constraints, turns, undefined);
        }
        return;
      }

      if (msg.type === "prompt") {
        // We only act on "last=true" — intermediate prompts are streaming partials.
        if (msg.last !== true) return;
        const text = String(msg.voicePrompt ?? "").trim();
        if (!text) return;
        console.log(`[relay] other said: ${text.slice(0, 120)}`);
        await takeTurn(ws, callId, goal, constraints, turns, text);
        return;
      }

      if (msg.type === "interrupt") {
        // User cut us off mid-speech. We can just let the next "prompt" drive
        // the reply — no explicit handling needed.
        console.log(`[relay] interrupted`);
        return;
      }

      if (msg.type === "dtmf") {
        // Treat button presses as text the agent can reason about.
        const digit = String(msg.digit ?? "");
        if (!digit) return;
        await takeTurn(ws, callId, goal, constraints, turns, `[They pressed ${digit} on the keypad.]`);
        return;
      }

      if (msg.type === "error") {
        console.warn(`[relay] twilio error: ${msg.description}`);
        return;
      }
    } catch (e) {
      console.error("[relay] error handling message:", e);
    }
  });

  ws.on("close", async (code, reason) => {
    console.log(`[relay] connection closed code=${code} reason=${reason}`);
    // The /complete webhook (via Twilio StatusCallback) is the authoritative
    // place to finalise the row. We just log here.
  });
}

async function takeTurn(
  ws: WebSocket,
  callId: string,
  goal: string,
  constraints: Record<string, unknown>,
  turns: OutboundTurn[],
  latestFromOther: string | undefined,
) {
  const result = await outboundTurn({
    goal,
    constraints,
    turns,
    latestFromOther,
  });

  const now = new Date().toISOString();
  if (latestFromOther) {
    turns.push({ role: "other", text: latestFromOther, at: now });
  }
  turns.push({ role: "agent", text: result.say, at: now });

  const patch: Record<string, unknown> = { turns };
  if (result.action === "hangup" && result.outcome) {
    patch.outcome = result.outcome;
  }
  await supabase.from("outbound_calls").update(patch).eq("id", callId);

  // Send the spoken reply as one message. The "token" field gets spoken;
  // last=true tells Twilio this is the end of the turn.
  ws.send(JSON.stringify({ type: "text", token: result.say, last: true }));

  if (result.action === "hangup") {
    // Give Twilio a moment to finish speaking before ending.
    setTimeout(() => {
      try {
        ws.send(JSON.stringify({ type: "end" }));
        ws.close(1000, "done");
      } catch { /* already closed */ }
    }, 1200);
  }
}
