// Meeting-transcript commitments extractor. Runs once at the tail of
// finaliseSession() so every meeting automatically surfaces promises the
// user made ("I'll send pricing Friday") or was given ("I'll come back
// Thursday") — the same way the email scanner does, but from spoken
// transcripts instead of sent/received mail.
//
// Uses the same commitments table + dedup scheme as the email extractor,
// distinguishing itself only via source_kind='meeting'.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4000;
const MAX_TRANSCRIPT_CHARS = 24_000;

type Extracted = {
  direction: "outbound" | "inbound";
  other_party: string;
  commitment_text: string;
  deadline: string | null;
  confidence: number;
};

export interface MeetingExtractionResult {
  new_commitments: number;
  updated_commitments: number;
  skipped: number;
}

export async function extractCommitmentsFromMeeting(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  transcript: string,
  meetingTitle: string,
  meetingStartedAt: string,
): Promise<MeetingExtractionResult> {
  const trimmed = transcript.trim();
  if (!trimmed || trimmed.length < 120) {
    return { new_commitments: 0, updated_commitments: 0, skipped: 0 };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();
  const userName = (profile?.display_name as string | undefined) ?? "the user";

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey: key });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(userName, meetingStartedAt),
    messages: [
      {
        role: "user",
        content: `Meeting title: ${meetingTitle}\nMeeting date: ${meetingStartedAt}\n\nTranscript:\n"""\n${trimmed.slice(0, MAX_TRANSCRIPT_CHARS)}\n"""`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const extracted = parseExtracted(text);

  return persistCommitments(admin, userId, sessionId, meetingTitle, extracted);
}

function buildSystemPrompt(userName: string, meetingDate: string): string {
  return [
    `You are JARVIS's commitments-extractor. You receive a transcript of a`,
    `live meeting ${userName} was part of (no speaker labels, possible ASR errors)`,
    `and extract every PROMISE — a statement that someone will do something.`,
    "",
    "Two directions:",
    `- OUTBOUND: ${userName} promised THEM. "I'll send the deck Friday", "I'll`,
    `  come back with pricing tomorrow". Speaker here is ${userName}.`,
    `- INBOUND: THEY promised ${userName} something. "I'll share the draft",`,
    `  "Let me get back to you Thursday". Speaker here is the other party.`,
    "",
    "Rules:",
    "- Skip vague pleasantries ('let's catch up', 'we should talk soon').",
    "- Skip hypothetical / conditional promises ('if we go ahead, I'll…').",
    "- Skip things already done inside the meeting ('I just sent it').",
    "- Without speaker labels, infer direction from first-person pronouns in",
    "  the surrounding sentences. Default to outbound when it's genuinely",
    "  ambiguous but the statement sounds like a first-person commitment.",
    "- commitment_text: crisp one-line in first person of the promiser",
    "  (e.g. 'Send pricing proposal', 'Share the Figma link').",
    "- other_party: best guess at who the other human is. Use any name that",
    `  appears in the transcript; otherwise 'meeting attendee'. Never`,
    `  ${userName}.`,
    `- deadline: ISO 8601 if a concrete time is stated or clearly implied`,
    `  ('Friday', 'next week', 'end of week'), parsed relative to meeting`,
    `  date ${meetingDate}. null if vague.`,
    "- confidence: 0.0-1.0 (skip anything < 0.6 — meetings are noisier than email).",
    "",
    "Reply as a JSON array only — no prose, no markdown. Empty array if nothing meaningful. Example:",
    '[{"direction":"outbound","other_party":"Ana","commitment_text":"Send pricing proposal","deadline":"2026-04-26T17:00:00Z","confidence":0.85}]',
  ].join("\n");
}

function parseExtracted(text: string): Extracted[] {
  const cleaned = text.trim().replace(/^```json\n?|\n?```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((r): Extracted | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const direction = o.direction;
      if (direction !== "outbound" && direction !== "inbound") return null;
      if (typeof o.other_party !== "string" || !o.other_party.trim()) return null;
      if (typeof o.commitment_text !== "string" || !o.commitment_text.trim()) return null;
      if (typeof o.confidence !== "number" || o.confidence < 0.6) return null;
      return {
        direction,
        other_party: o.other_party.trim(),
        commitment_text: o.commitment_text.trim(),
        deadline: typeof o.deadline === "string" ? o.deadline : null,
        confidence: o.confidence,
      };
    })
    .filter((r): r is Extracted => r !== null);
}

function dedupKey(r: Extracted): string {
  return `${r.direction}|${r.other_party.toLowerCase()}|${r.commitment_text.toLowerCase().slice(0, 80)}`;
}

async function persistCommitments(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  meetingTitle: string,
  rows: Extracted[],
): Promise<MeetingExtractionResult> {
  let newCount = 0;
  let updatedCount = 0;
  let skipped = 0;

  for (const r of rows) {
    const key = dedupKey(r);
    const { data: existing } = await admin
      .from("commitments")
      .select("id")
      .eq("user_id", userId)
      .eq("dedup_key", key)
      .maybeSingle();

    if (existing) {
      await admin
        .from("commitments")
        .update({
          commitment_text: r.commitment_text,
          deadline: r.deadline,
          confidence: r.confidence,
          source_kind: "meeting",
          source_meeting_id: sessionId,
          source_meeting_title: meetingTitle,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id as string);
      updatedCount += 1;
    } else {
      const { error } = await admin.from("commitments").insert({
        user_id: userId,
        direction: r.direction,
        other_party: r.other_party,
        other_party_email: null,
        commitment_text: r.commitment_text,
        dedup_key: key,
        deadline: r.deadline,
        confidence: r.confidence,
        source_kind: "meeting",
        source_meeting_id: sessionId,
        source_meeting_title: meetingTitle,
      });
      if (error) {
        skipped += 1;
        continue;
      }
      newCount += 1;
    }
  }

  return { new_commitments: newCount, updated_commitments: updatedCount, skipped };
}
