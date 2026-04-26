"use client";

import { useCallback, useEffect, useState } from "react";

type Voice = {
  tone_keywords: string[];
  avoid_words: string[];
  greeting: string | null;
  signature: string | null;
  voice_notes: string | null;
  sample_email: string | null;
  sample_message: string | null;
  sample_post: string | null;
  updated_at: string | null;
};

const EMPTY: Voice = {
  tone_keywords: [],
  avoid_words: [],
  greeting: null,
  signature: null,
  voice_notes: null,
  sample_email: null,
  sample_message: null,
  sample_post: null,
  updated_at: null,
};

export function BrandVoiceConsole() {
  const [voice, setVoice] = useState<Voice>(EMPTY);
  const [tone, setTone] = useState("");
  const [avoid, setAvoid] = useState("");
  const [greeting, setGreeting] = useState("");
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [sampleEmail, setSampleEmail] = useState("");
  const [sampleMessage, setSampleMessage] = useState("");
  const [samplePost, setSamplePost] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/brand-voice");
    if (!res.ok) return;
    const json = (await res.json()) as { voice: Voice };
    const v = json.voice;
    setVoice(v);
    setTone(v.tone_keywords.join(", "));
    setAvoid(v.avoid_words.join(", "));
    setGreeting(v.greeting ?? "");
    setSignature(v.signature ?? "");
    setNotes(v.voice_notes ?? "");
    setSampleEmail(v.sample_email ?? "");
    setSampleMessage(v.sample_message ?? "");
    setSamplePost(v.sample_post ?? "");
    setSavedAt(v.updated_at);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        tone_keywords: tone
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        avoid_words: avoid
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        greeting: greeting.trim() || null,
        signature: signature.trim() || null,
        voice_notes: notes.trim() || null,
        sample_email: sampleEmail.trim() || null,
        sample_message: sampleMessage.trim() || null,
        sample_post: samplePost.trim() || null,
      };
      const res = await fetch("/api/brand-voice", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px 80px", maxWidth: 880 }}>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        Define how you sound. Every draft the writer agent produces — emails, LinkedIn posts, tweets, cold
        outreach, WhatsApp replies — gets this config injected into its system prompt before generating, so
        what comes back sounds like you, not generic AI.
        {savedAt && (
          <span style={{ display: "block", marginTop: 6, fontFamily: "var(--mono)", fontSize: 11, fontStyle: "normal", color: "var(--ink-3)", letterSpacing: "1px" }}>
            Last saved {new Date(savedAt).toLocaleString()}
          </span>
        )}
      </div>

      <Section title="Tone keywords" hint="Comma-separated. The 3-7 words that describe how you sound at your best.">
        <input
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="direct, warm, no-fluff, dry, confident, British, lowercase-friendly"
          style={inputStyle}
        />
      </Section>

      <Section title="Words to avoid" hint="Comma-separated. Corporate filler, clichés, words that don't sound like you.">
        <input
          value={avoid}
          onChange={(e) => setAvoid(e.target.value)}
          placeholder="leverage, synergy, circle back, reach out, hope this finds you well, just wanted to"
          style={inputStyle}
        />
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Section title="Default greeting" hint="How you usually open a message. Leave blank to default to context.">
          <input
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="Hey [name],"
            style={inputStyle}
          />
        </Section>
        <Section title="Sign-off / signature" hint="How you close.">
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="— Reiss"
            style={inputStyle}
          />
        </Section>
      </div>

      <Section
        title="Voice notes"
        hint="Free-form notes the writer should know. Sentence-level habits, structure preferences, anything that's hard to capture as keywords."
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="I like short sentences. I avoid em-dashes in casual writing. I sign off with first name only. I never use exclamation marks unless I'm genuinely excited. I prefer 'I think' to 'I believe'. I open emails with the ask, not the pleasantries."
          rows={5}
          style={{ ...inputStyle, fontFamily: "var(--sans)", lineHeight: 1.5, resize: "vertical" }}
        />
      </Section>

      <Section
        title="Sample email"
        hint="Paste an email you wrote that captures your voice at its best. The writer studies this for tone."
      >
        <textarea
          value={sampleEmail}
          onChange={(e) => setSampleEmail(e.target.value)}
          placeholder="Hey Sarah, …"
          rows={8}
          style={{ ...inputStyle, fontFamily: "var(--sans)", lineHeight: 1.5, resize: "vertical" }}
        />
      </Section>

      <Section title="Sample short message" hint="DM or WhatsApp. Anything short you've written that sounds like you.">
        <textarea
          value={sampleMessage}
          onChange={(e) => setSampleMessage(e.target.value)}
          placeholder=""
          rows={4}
          style={{ ...inputStyle, fontFamily: "var(--sans)", lineHeight: 1.5, resize: "vertical" }}
        />
      </Section>

      <Section title="Sample post" hint="LinkedIn or Twitter post that captures how you write publicly.">
        <textarea
          value={samplePost}
          onChange={(e) => setSamplePost(e.target.value)}
          placeholder=""
          rows={6}
          style={{ ...inputStyle, fontFamily: "var(--sans)", lineHeight: 1.5, resize: "vertical" }}
        />
      </Section>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 8 }}>
        <button
          onClick={save}
          disabled={busy}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: "10px 22px",
            borderRadius: 8,
            border: "1px solid var(--rule)",
            background: busy ? "var(--surface-2)" : "var(--ink)",
            color: busy ? "var(--ink-3)" : "var(--bg)",
            cursor: busy ? "default" : "pointer",
            letterSpacing: "0.6px",
            textTransform: "uppercase",
          }}
        >
          {busy ? "Saving…" : "Save voice"}
        </button>
      </div>

      {voice.tone_keywords.length === 0 && voice.voice_notes === null && voice.sample_email === null && (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 15,
            color: "var(--ink-3)",
            background: "var(--surface)",
            border: "1px dashed var(--rule)",
            borderRadius: 12,
          }}
        >
          The writer agent works without this — but generic by default. Fill in even just tone keywords and a sample, and every draft sharpens.
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.6px",
          color: "var(--ink-3)",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      {hint && (
        <div style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 13,
  padding: "10px 12px",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--ink)",
  outline: "none",
  letterSpacing: "0.3px",
  width: "100%",
  boxSizing: "border-box",
};
