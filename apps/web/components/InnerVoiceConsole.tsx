"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Utterance = {
  id: string;
  scan_id: string;
  voice: VoiceKey;
  excerpt: string;
  gloss: string;
  intensity: number;
  spoken_at: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  created_at: string;
};

type LatestScan = {
  id: string;
  window_days: number;
  total_utterances: number;
  dominant_voice: VoiceKey | null;
  second_voice: VoiceKey | null;
  voice_counts: Record<string, number>;
  atlas_narrative: string | null;
  created_at: string;
};

type VoiceKey =
  | "critic" | "dreamer" | "calculator" | "frightened" | "soldier"
  | "philosopher" | "victim" | "coach" | "comedian" | "scholar";

type StatusKey = "live" | "pinned" | "archived" | "all";

const VOICES: VoiceKey[] = [
  "critic", "dreamer", "calculator", "frightened", "soldier",
  "philosopher", "victim", "coach", "comedian", "scholar",
];

const VOICE_TINT: Record<VoiceKey, string> = {
  critic: "#f4c9d8",
  dreamer: "#c9b3f4",
  calculator: "#bfd4ee",
  frightened: "#f4a8a8",
  soldier: "#fbb86d",
  philosopher: "#e8e0d2",
  victim: "#9aa28e",
  coach: "#7affcb",
  comedian: "#ffd966",
  scholar: "#b8c9b8",
};

const VOICE_BLURB: Record<VoiceKey, string> = {
  critic: "the judge",
  dreamer: "the visionary",
  calculator: "the planner",
  frightened: "the fear",
  soldier: "the discipline",
  philosopher: "the seeker",
  victim: "the helpless",
  coach: "the encourager",
  comedian: "the deflector",
  scholar: "the noticer",
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  if (day < 90) return `${Math.round(day / 7)}w ago`;
  return `${Math.round(day / 30)}mo ago`;
}

function dotMeter(score: number, color: string): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 7, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function InnerVoiceConsole() {
  const [rows, setRows] = useState<Utterance[]>([]);
  const [latestScan, setLatestScan] = useState<LatestScan | null>(null);
  const [voiceCounts, setVoiceCounts] = useState<Record<string, number>>({});
  const [voiceFilter, setVoiceFilter] = useState<VoiceKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("live");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(90);

  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (voiceFilter !== "all") params.set("voice", voiceFilter);
      params.set("status", statusFilter);
      params.set("limit", "200");
      const r = await fetch(`/api/inner-voice?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        utterances: Utterance[];
        latest_scan: LatestScan | null;
        stats: { total: number; voice_counts: Record<string, number> };
      };
      setRows(j.utterances);
      setLatestScan(j.latest_scan);
      setVoiceCounts(j.stats.voice_counts ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [voiceFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/inner-voice/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: composeWindow }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; latency_ms?: number; signals?: Record<string, number> };
      setScanResult({ inserted: j.inserted, latency_ms: j.latency_ms, signals: j.signals });
      setComposeOpen(false);
      setStatusFilter("live");
      setVoiceFilter("all");
      await load();
      setTimeout(() => setScanResult(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/inner-voice/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.text();
        throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const totalCount = useMemo(() => Object.values(voiceCounts).reduce((a, b) => a + b, 0), [voiceCounts]);

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {latestScan ? `${latestScan.total_utterances} utterances · ${latestScan.window_days}d window · scanned ${relTime(latestScan.created_at)}` : "no atlas scan yet"}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: VOICE_TINT.dreamer, color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          {latestScan ? "Run new atlas scan" : "Run first atlas scan"}
        </button>
      </div>

      {/* Atlas summary card */}
      {latestScan && (
        <div style={{ border: `1px solid #2a2620`, borderLeft: `3px solid ${latestScan.dominant_voice ? VOICE_TINT[latestScan.dominant_voice] : "#3a342c"}`, padding: 18, marginBottom: 22, background: "#171411" }}>
          {latestScan.dominant_voice && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#8a8378", letterSpacing: 1.6, textTransform: "uppercase" }}>Dominant voice</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: VOICE_TINT[latestScan.dominant_voice], letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>
                The {latestScan.dominant_voice}
              </div>
              <div style={{ fontSize: 13, color: "#8a8378", fontStyle: "italic", marginTop: 2 }}>
                {VOICE_BLURB[latestScan.dominant_voice]}
                {latestScan.second_voice && (
                  <>
                    {" · "}
                    <span style={{ color: VOICE_TINT[latestScan.second_voice] }}>then the {latestScan.second_voice}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Distribution stacked bar */}
          <div style={{ display: "flex", height: 8, marginTop: 10, marginBottom: 10, background: "#1c1815", overflow: "hidden" }}>
            {VOICES.map((v) => {
              const count = latestScan.voice_counts?.[v] ?? 0;
              const pct = latestScan.total_utterances > 0 ? (count / latestScan.total_utterances) * 100 : 0;
              if (pct === 0) return null;
              return <div key={v} title={`${v}: ${count}`} style={{ width: `${pct}%`, background: VOICE_TINT[v] }} />;
            })}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: "#8a8378", marginBottom: latestScan.atlas_narrative ? 14 : 0 }}>
            {VOICES.map((v) => {
              const count = latestScan.voice_counts?.[v] ?? 0;
              if (count === 0) return null;
              const pct = latestScan.total_utterances > 0 ? Math.round((count / latestScan.total_utterances) * 100) : 0;
              return (
                <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, background: VOICE_TINT[v], display: "inline-block" }} />
                  <span style={{ color: "#e8e0d2" }}>{v}</span>
                  <span>{count} · {pct}%</span>
                </span>
              );
            })}
          </div>

          {latestScan.atlas_narrative && (
            <div style={{ borderTop: "1px solid #2a2620", paddingTop: 12, fontFamily: "Georgia, serif", fontSize: 15, fontStyle: "italic", color: "#e8e0d2", lineHeight: 1.55 }}>
              {latestScan.atlas_narrative}
            </div>
          )}
        </div>
      )}

      {/* Voice filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {(["all", ...VOICES] as const).map((v) => {
          const active = voiceFilter === v;
          const count = v === "all" ? totalCount : (voiceCounts[v] ?? 0);
          const tint = v === "all" ? "#e8e0d2" : VOICE_TINT[v];
          return (
            <button
              key={v}
              onClick={() => setVoiceFilter(v)}
              style={{
                background: active ? tint : "transparent",
                color: active ? "#1c1815" : tint,
                border: `1px solid ${tint}`,
                padding: "5px 12px",
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              {v === "all" ? "all" : v} {count > 0 ? `· ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Status pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {(["live", "pinned", "archived", "all"] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                background: active ? "#3a342c" : "transparent",
                color: active ? "#e8e0d2" : "#8a8378",
                border: `1px solid ${active ? "#5a544c" : "#2a2620"}`,
                padding: "4px 10px",
                fontSize: 10,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {error && <div style={{ color: "#f4a8a8", fontSize: 13, marginBottom: 12 }}>error: {error}</div>}
      {scanResult && (
        <div style={{ background: "#171411", border: `1px solid ${VOICE_TINT.dreamer}`, padding: 12, marginBottom: 14, fontSize: 12, color: "#e8e0d2" }}>
          atlas updated · {scanResult.inserted} utterances · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.candidate_messages != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.candidate_messages} candidate messages, {scanResult.signals.sampled} sampled</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading utterances...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {latestScan ? "no utterances match this filter" : "run an atlas scan to map your inner voice"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((u) => {
            const tint = VOICE_TINT[u.voice];
            return (
              <div
                key={u.id}
                style={{
                  border: `1px solid ${u.pinned ? tint : "#2a2620"}`,
                  borderLeft: `3px solid ${tint}`,
                  padding: 14,
                  background: u.archived_at ? "#0f0d0a" : "#171411",
                  opacity: u.archived_at ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: tint, letterSpacing: 1.4, textTransform: "uppercase" }}>{u.voice}</span>
                    <span style={{ fontSize: 10, color: "#5a544c", fontStyle: "italic" }}>{VOICE_BLURB[u.voice]}</span>
                    {dotMeter(u.intensity, tint)}
                    {u.pinned && (
                      <span style={{ fontSize: 9, color: tint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>{u.spoken_at}</div>
                </div>

                <div style={{ background: "#1c1815", borderLeft: `2px solid ${tint}`, padding: "10px 12px", marginBottom: 8 }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 15, fontStyle: "italic", color: "#e8e0d2", lineHeight: 1.5 }}>
                    &ldquo;{u.excerpt}&rdquo;
                  </div>
                </div>

                <div style={{ fontSize: 13, color: "#bfb5a8", marginBottom: u.user_note ? 8 : 0, lineHeight: 1.5 }}>
                  {u.gloss}
                </div>

                {u.user_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic" }}>
                    note: {u.user_note}
                  </div>
                )}

                {/* Note panel */}
                {noteOpenId === u.id ? (
                  <div style={{ marginTop: 10, borderTop: "1px solid #2a2620", paddingTop: 10 }}>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="add a note about this utterance..."
                      rows={2}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: "1px solid #2a2620", padding: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          if (noteDraft.trim().length === 0) return;
                          await patch(u.id, { user_note: noteDraft });
                          setNoteOpenId(null);
                          setNoteDraft("");
                        }}
                        style={{ background: tint, color: "#1c1815", border: "none", padding: "5px 12px", fontSize: 11, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
                      >
                        save note
                      </button>
                      <button
                        onClick={() => { setNoteOpenId(null); setNoteDraft(""); }}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, cursor: "pointer" }}
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2620" }}>
                    <button
                      onClick={() => { setNoteOpenId(u.id); setNoteDraft(u.user_note ?? ""); }}
                      style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                    >
                      {u.user_note ? "edit note" : "+ note"}
                    </button>
                    <button
                      onClick={() => patch(u.id, { pin: !u.pinned })}
                      style={{ background: "transparent", color: u.pinned ? tint : "#8a8378", border: `1px solid ${u.pinned ? tint : "#2a2620"}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                    >
                      {u.pinned ? "unpin" : "pin"}
                    </button>
                    {u.archived_at ? (
                      <button
                        onClick={() => patch(u.id, { restore: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        restore
                      </button>
                    ) : (
                      <button
                        onClick={() => patch(u.id, { archive: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        archive
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <div
          onClick={() => setComposeOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#171411", border: `1px solid ${VOICE_TINT.dreamer}`, padding: 24, width: "min(440px, 92vw)" }}
          >
            <div style={{ fontSize: 13, color: VOICE_TINT.dreamer, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 12 }}>
              Run inner voice atlas scan
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.5, marginBottom: 16 }}>
              Mines your messages from the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong>, classifies each piece of self-talk into one of ten voices, and writes a summary of the texture.
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>Window</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[14, 30, 60, 90, 120, 180, 365].map((days) => (
                  <button
                    key={days}
                    onClick={() => setComposeWindow(days)}
                    style={{
                      background: composeWindow === days ? VOICE_TINT.dreamer : "transparent",
                      color: composeWindow === days ? "#1c1815" : "#bfb5a8",
                      border: `1px solid ${composeWindow === days ? VOICE_TINT.dreamer : "#2a2620"}`,
                      padding: "5px 11px",
                      fontSize: 11,
                      letterSpacing: 0.6,
                      cursor: "pointer",
                      fontWeight: composeWindow === days ? 700 : 500,
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                onClick={runScan}
                disabled={scanning}
                style={{
                  background: scanning ? "#3a342c" : VOICE_TINT.dreamer,
                  color: scanning ? "#8a8378" : "#1c1815",
                  border: "none",
                  padding: "9px 16px",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: scanning ? "not-allowed" : "pointer",
                }}
              >
                {scanning ? "scanning..." : "Run atlas scan"}
              </button>
              <button
                onClick={() => setComposeOpen(false)}
                style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "9px 16px", fontSize: 12, cursor: "pointer" }}
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
