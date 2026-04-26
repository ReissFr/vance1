// Meeting Ghost — session orchestration + transcription + finalisation.
//
// A meeting session records a continuous window of audio → text segments →
// one rolled-up summary + action items, ingested into recall as
// source='meeting' so search hits it like everything else.
//
// Stack: browser MediaRecorder → /api/meetings/chunk (this file's
// transcribeAudioBlob) → append segment. On stop: summarise with Anthropic
// (Haiku) and ingest.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestEvent, searchRecall } from "./recall";
import { extractCommitmentsFromMeeting } from "./commitments-meeting";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export interface MeetingSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  summary: string | null;
  action_items: string | null;
  participants: string[];
  translate_to_english: boolean;
  detected_language: string | null;
}

export interface MeetingSegment {
  id: string;
  session_id: string;
  started_at: string;
  text: string;
  original_text: string | null;
  language: string | null;
}

export async function startSession(
  admin: SupabaseClient,
  userId: string,
  opts: { translateToEnglish?: boolean } = {},
): Promise<MeetingSession> {
  const { data, error } = await admin
    .from("meeting_sessions")
    .insert({
      user_id: userId,
      translate_to_english: opts.translateToEnglish ?? false,
    })
    .select("*")
    .single();
  if (error) throw new Error(`startSession: ${error.message}`);
  return data as MeetingSession;
}

export async function getActiveSession(
  admin: SupabaseClient,
  userId: string,
): Promise<MeetingSession | null> {
  const { data } = await admin
    .from("meeting_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MeetingSession | null) ?? null;
}

export async function appendSegment(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  text: string,
  extras: { originalText?: string | null; language?: string | null } = {},
): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  await admin.from("meeting_segments").insert({
    session_id: sessionId,
    user_id: userId,
    text: clean,
    original_text: extras.originalText?.trim() || null,
    language: extras.language ?? null,
  });
}

export async function listRecentSegments(
  admin: SupabaseClient,
  sessionId: string,
  limit = 200,
): Promise<MeetingSegment[]> {
  const { data } = await admin
    .from("meeting_segments")
    .select("id, session_id, started_at, text, original_text, language")
    .eq("session_id", sessionId)
    .order("started_at", { ascending: true })
    .limit(limit);
  return (data as MeetingSegment[] | null) ?? [];
}

export async function listSessions(
  admin: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<MeetingSession[]> {
  const { data } = await admin
    .from("meeting_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data as MeetingSession[] | null) ?? [];
}

// ── Transcription ──────────────────────────────────────────────────────────

export interface TranscribeResult {
  // The text we want to display + feed to the coach + summarise. Always
  // English if translateToEnglish is on and the source was non-English;
  // otherwise the raw transcript.
  text: string;
  // Present only when translation actually happened (source was non-English
  // and translateToEnglish was on). The preserved source-language transcript.
  originalText: string | null;
  // Whisper's detected language code (e.g. "en", "pt", "es"). Null if
  // translation was off (we pin language=en for speed).
  language: string | null;
}

export async function transcribeAudioBlob(
  audio: Blob,
  opts: { translateToEnglish?: boolean } = {},
): Promise<TranscribeResult> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error("GROQ_API_KEY not set");

  const upstream = new FormData();
  upstream.append("file", audio, "chunk.webm");
  upstream.append("model", "whisper-large-v3-turbo");
  if (opts.translateToEnglish) {
    // Auto-detect language + return detected code.
    upstream.append("response_format", "verbose_json");
  } else {
    upstream.append("response_format", "json");
    upstream.append("language", "en");
  }

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${groqKey}` },
    body: upstream,
  });
  if (!res.ok) throw new Error(`groq stt: ${await res.text()}`);
  const data = (await res.json()) as { text?: string; language?: string };
  const raw = (data.text ?? "").trim();
  if (!raw) return { text: "", originalText: null, language: data.language ?? null };

  if (!opts.translateToEnglish) {
    return { text: raw, originalText: null, language: null };
  }

  const lang = (data.language ?? "").toLowerCase();
  // Whisper reports "english" or "en" depending on version; handle both.
  if (!lang || lang === "en" || lang === "english") {
    return { text: raw, originalText: null, language: "en" };
  }

  const english = await translateToEnglish(raw, lang);
  return { text: english || raw, originalText: raw, language: lang };
}

async function translateToEnglish(text: string, sourceLang: string): Promise<string> {
  return translateText(text, sourceLang, "en");
}

export async function translateFromEnglish(text: string, targetLang: string): Promise<string> {
  return translateText(text, "en", targetLang);
}

async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return text;
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system:
      "You translate short spoken-conversation chunks between languages. " +
      "Preserve tone and meaning. The output will be spoken aloud, so favour " +
      "natural speech rhythm over literal word-for-word rendering. Never add " +
      "commentary, quotes, or preamble. Output only the translated text.",
    messages: [
      {
        role: "user",
        content: `From: ${sourceLang}\nTo: ${targetLang}\n\n${text}`,
      },
    ],
  });
  const out = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return out;
}

// ── Finalisation ───────────────────────────────────────────────────────────

export interface FinaliseResult {
  title: string;
  summary: string;
  actionItems: string;
  recallEventId: string | null;
}

export async function finaliseSession(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<FinaliseResult> {
  const { data: session, error: loadErr } = await admin
    .from("meeting_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  if (loadErr || !session) throw new Error("session not found");

  const segments = await listRecentSegments(admin, sessionId, 1000);
  const transcript = segments.map((s) => s.text).join(" ").slice(0, 60_000);

  const { title, summary, actionItems } = transcript
    ? await summariseTranscript(transcript)
    : { title: "(empty meeting)", summary: "No audio transcribed.", actionItems: "" };

  const endedAt = new Date().toISOString();

  // Ingest the whole meeting into recall so it searches like everything else.
  let recallEventId: string | null = null;
  if (transcript) {
    const body = [
      summary,
      actionItems ? `\nAction items:\n${actionItems}` : "",
      `\nFull transcript:\n${transcript}`,
    ].join("");
    await ingestEvent(admin, {
      userId,
      source: "meeting",
      externalId: sessionId,
      title,
      body,
      occurredAt: session.started_at,
      metadata: { duration_ms: new Date(endedAt).getTime() - new Date(session.started_at).getTime() },
    });
    const { data: event } = await admin
      .from("recall_events")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "meeting")
      .eq("external_id", sessionId)
      .maybeSingle();
    recallEventId = (event?.id as string | undefined) ?? null;
  }

  await admin
    .from("meeting_sessions")
    .update({
      ended_at: endedAt,
      title,
      summary,
      action_items: actionItems,
      recall_event_id: recallEventId,
    })
    .eq("id", sessionId);

  // Fire-and-forget: extract commitments from the transcript into the same
  // tracker the email scanner feeds. Failures here must not block the stop
  // response — the meeting is already saved.
  if (transcript) {
    void extractCommitmentsFromMeeting(
      admin,
      userId,
      sessionId,
      transcript,
      title,
      session.started_at,
    ).catch((e) => {
      console.error("[meetings] commitments extraction failed:", e);
    });
  }

  return { title, summary, actionItems, recallEventId };
}

async function summariseTranscript(transcript: string): Promise<{
  title: string;
  summary: string;
  actionItems: string;
}> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system:
      "You summarise meeting transcripts produced by a raw speech-to-text system, " +
      "which means no speaker labels and some word-errors. " +
      "Be terse. Output exactly three sections separated by '---': " +
      "line 1 = TITLE (max 8 words). " +
      "line 2 = SUMMARY (3-6 bullet points, no preamble). " +
      "line 3 = ACTION_ITEMS (bullets of concrete next steps for the user; empty string if none).",
    messages: [
      {
        role: "user",
        content: `Transcript:\n"""\n${transcript}\n"""\n\nFormat:\n<title>\n---\n<summary bullets>\n---\n<action items bullets or empty>`,
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const [title = "(untitled meeting)", summary = "", actionItems = ""] = text
    .split(/\n---\n/)
    .map((s) => s.trim());
  return { title: title.slice(0, 120), summary, actionItems };
}

// ── Earpiece Coach ─────────────────────────────────────────────────────────
//
// Every coach tick takes the last ~90s of transcript + does a recall search
// and asks a small model: "is there a one-liner that would help the user
// right now?". Returns null most of the time (silence is right 90% of the
// time). Called from /api/meetings/coach every ~15s by the live page.

export interface CoachHint {
  id: string; // uuid-ish, client-side de-dupe key
  text: string;
  source: "recall" | "context";
  createdAt: string;
}

const COACH_TAIL_CHARS = 2000;

export async function coachTurn(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<CoachHint | null> {
  const segments = await listRecentSegments(admin, sessionId, 60);
  const tail = segments.map((s) => s.text).join(" ").slice(-COACH_TAIL_CHARS);
  if (!tail || tail.length < 60) return null;

  // Cheap retrieval on the tail — anything relevant from past meetings,
  // emails, etc. that a human PA would whisper in your ear right now.
  let recallContext = "";
  try {
    const hits = await searchRecall(admin, userId, tail, { matchCount: 5 });
    recallContext = hits
      .map((h, i) => `[${i + 1}] ${h.source} · ${h.title ?? ""} · ${h.body.slice(0, 300)}`)
      .join("\n");
  } catch {
    // Embedding failures shouldn't kill the coach loop.
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const client = new Anthropic({ apiKey: key });

  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 200,
    system: [
      "You are an earpiece coach whispering to the user during a live conversation.",
      "Most of the time, say nothing — output the single token NONE. Only speak when",
      "the user would clearly benefit from a fact, name, number, or reminder they can't",
      "easily recall. Examples worth whispering: the name of someone just mentioned,",
      "the price quoted in a prior email, the date of a prior commitment, a relevant",
      "fact from recall context. Never coach on 'what to say next' — you are a memory,",
      "not a script.",
      "Output rule: either output exactly 'NONE', or one short sentence (<= 20 words)",
      "with the useful fact. No preamble. No 'You could say'.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          `Recall hits (possibly useful facts from the user's history):\n${recallContext || "(none)"}`,
          "",
          `Live transcript tail (last ~90s, no speaker labels):\n"""\n${tail}\n"""`,
          "",
          "Whisper one useful fact, or output NONE.",
        ].join("\n"),
      },
    ],
  });

  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!text || /^none$/i.test(text)) return null;
  if (text.length > 240) return null; // safety bound on runaway outputs
  return {
    id: crypto.randomUUID(),
    text,
    source: recallContext ? "recall" : "context",
    createdAt: new Date().toISOString(),
  };
}
