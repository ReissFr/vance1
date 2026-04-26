"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EchoKind = "reflection" | "decision" | "daily_checkin";
type StatusFilter = "open" | "dismissed" | "all";

type Echo = {
  id: string;
  source_kind: EchoKind;
  source_id: string;
  source_text_excerpt: string;
  source_date: string;
  match_kind: EchoKind;
  match_id: string;
  match_text_excerpt: string;
  match_date: string;
  similarity: number;
  similarity_note: string;
  user_note: string | null;
  dismissed_at: string | null;
  created_at: string;
};

const KIND_LABEL: Record<EchoKind, string> = {
  reflection: "Reflection",
  decision: "Decision",
  daily_checkin: "Check-in",
};

const KIND_HREF: Record<EchoKind, string> = {
  reflection: "/reflections",
  decision: "/decisions",
  daily_checkin: "/daily-checkin",
};

const KIND_COLOR: Record<EchoKind, string> = {
  reflection: "#bfd4ee",
  decision: "#fbb86d",
  daily_checkin: "#7affcb",
};

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round(Math.abs(a - b) / 86_400_000);
}

function timeGap(aIso: string, bIso: string): string {
  const days = daysBetween(aIso, bIso);
  if (days < 14) return `${days}d apart`;
  if (days < 60) return `${Math.round(days / 7)}w apart`;
  if (days < 365) return `${Math.round(days / 30)}mo apart`;
  const years = days / 365;
  return years >= 2 ? `${Math.round(years)}yrs apart` : `${years.toFixed(1)}yrs apart`;
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function SimilarityDots({ value }: { value: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2, fontSize: 11, letterSpacing: "0.05em" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ color: n <= value ? "#fbb86d" : "rgba(255,255,255,0.18)" }}>●</span>
      ))}
    </span>
  );
}

export function EchoJournalConsole() {
  const [echoes, setEchoes] = useState<Echo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [sinceDays, setSinceDays] = useState<14 | 30 | 60>(14);
  const [maxPerSource, setMaxPerSource] = useState(3);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  const refresh = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/echoes?status=${status}&limit=200`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setEchoes(Array.isArray(j.echoes) ? j.echoes : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(filter); }, [filter, refresh]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setScanNote(null);
    try {
      const r = await fetch("/api/echoes/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ since_days: sinceDays, max_per_source: maxPerSource }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "scan failed");
      const generated = Array.isArray(j.generated) ? j.generated.length : 0;
      const skipped = j.skipped_existing ?? 0;
      const note = j.note ?? null;
      const parts: string[] = [];
      if (generated > 0) parts.push(`${generated} new echo${generated === 1 ? "" : "es"}`);
      if (skipped > 0) parts.push(`${skipped} already existed`);
      if (note) parts.push(note);
      setScanNote(parts.length > 0 ? parts.join(" · ") : "no echoes returned");
      await refresh(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }, [sinceDays, maxPerSource, filter, refresh]);

  const dismiss = useCallback(async (id: string, dismiss: boolean) => {
    try {
      const r = await fetch(`/api/echoes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismiss }),
      });
      if (!r.ok) throw new Error("update failed");
      await refresh(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    }
  }, [filter, refresh]);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Delete this echo?")) return;
    try {
      const r = await fetch(`/api/echoes/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      await refresh(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }, [filter, refresh]);

  const saveNote = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/echoes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_note: editNote.trim() }),
      });
      if (!r.ok) throw new Error("save failed");
      setEditingId(null);
      setEditNote("");
      await refresh(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }, [editNote, filter, refresh]);

  // Group echoes by source so we render "this source has N matches" cards.
  const grouped = useMemo(() => {
    const map = new Map<string, { source: { kind: EchoKind; id: string; date: string; text: string }; matches: Echo[] }>();
    for (const e of echoes) {
      const key = `${e.source_kind}#${e.source_id}`;
      const existing = map.get(key);
      if (existing) existing.matches.push(e);
      else map.set(key, { source: { kind: e.source_kind, id: e.source_id, date: e.source_date, text: e.source_text_excerpt }, matches: [e] });
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.source.date.localeCompare(a.source.date));
    for (const g of arr) g.matches.sort((a, b) => b.similarity - a.similarity);
    return arr;
  }, [echoes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 80 }}>
      {/* Control panel */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: 20,
          background: "rgba(20,22,26,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Scan window</label>
            <div style={{ display: "flex", gap: 4 }}>
              {([14, 30, 60] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSinceDays(d)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: sinceDays === d ? "#fbb86d" : "rgba(255,255,255,0.04)",
                    color: sinceDays === d ? "#1a1c20" : "rgba(255,255,255,0.7)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Max per entry</label>
            <input
              type="number"
              min={1}
              max={5}
              value={maxPerSource}
              onChange={(e) => setMaxPerSource(Math.max(1, Math.min(5, parseInt(e.target.value || "3", 10))))}
              style={{
                width: 60,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "#fff",
                fontSize: 13,
              }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: scanning ? "rgba(251,184,108,0.4)" : "#fbb86d",
              color: "#1a1c20",
              fontSize: 13,
              fontWeight: 600,
              cursor: scanning ? "wait" : "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {scanning ? "Listening for echoes…" : "Find echoes"}
          </button>
        </div>
        {scanNote && (
          <div style={{ fontSize: 12, opacity: 0.7, fontStyle: "italic" }}>{scanNote}</div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: "#f4a3a3" }}>{error}</div>
        )}
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["open", "dismissed", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.12)",
              background: filter === s ? "rgba(255,255,255,0.12)" : "transparent",
              color: filter === s ? "#fff" : "rgba(255,255,255,0.6)",
              fontSize: 12,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Echoes */}
      {loading ? (
        <div style={{ opacity: 0.5, fontSize: 13 }}>Loading echoes…</div>
      ) : grouped.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 13, padding: 24, textAlign: "center", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 12 }}>
          {filter === "open"
            ? "No echoes yet. Run a scan to find moments where your recent writing mirrors entries from your past."
            : filter === "dismissed"
            ? "Nothing dismissed."
            : "No echoes recorded yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {grouped.map((group) => (
            <SourceGroup
              key={`${group.source.kind}#${group.source.id}`}
              source={group.source}
              matches={group.matches}
              editingId={editingId}
              editNote={editNote}
              setEditingId={setEditingId}
              setEditNote={setEditNote}
              saveNote={saveNote}
              dismiss={dismiss}
              remove={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceGroup({
  source,
  matches,
  editingId,
  editNote,
  setEditingId,
  setEditNote,
  saveNote,
  dismiss,
  remove,
}: {
  source: { kind: EchoKind; id: string; date: string; text: string };
  matches: Echo[];
  editingId: string | null;
  editNote: string;
  setEditingId: (id: string | null) => void;
  setEditNote: (note: string) => void;
  saveNote: (id: string) => void;
  dismiss: (id: string, dismiss: boolean) => void;
  remove: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Source header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderLeft: `3px solid ${KIND_COLOR[source.kind]}`,
          background: "rgba(255,255,255,0.025)",
          borderRadius: "0 8px 8px 0",
        }}
      >
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 999,
            background: `${KIND_COLOR[source.kind]}33`,
            color: KIND_COLOR[source.kind],
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {KIND_LABEL[source.kind]}
        </span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{formatShortDate(source.date)}</span>
        <span style={{ fontSize: 11, opacity: 0.4 }}>·</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {matches.length} echo{matches.length === 1 ? "" : "es"}
        </span>
        <a
          href={KIND_HREF[source.kind]}
          style={{ fontSize: 11, opacity: 0.5, textDecoration: "none", marginLeft: "auto" }}
        >
          open log →
        </a>
      </div>
      <div
        style={{
          fontStyle: "italic",
          fontSize: 14,
          opacity: 0.85,
          padding: "0 14px",
          fontFamily: "Georgia, serif",
        }}
      >
        “{source.text.length > 280 ? source.text.slice(0, 280) + "…" : source.text}”
      </div>

      {/* Match cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 18 }}>
        {matches.map((e) => (
          <div
            key={e.id}
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderLeft: `3px solid ${KIND_COLOR[e.match_kind]}`,
              borderRadius: 10,
              padding: 14,
              background: e.dismissed_at ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
              opacity: e.dismissed_at ? 0.6 : 1,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: `${KIND_COLOR[e.match_kind]}33`,
                  color: KIND_COLOR[e.match_kind],
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {KIND_LABEL[e.match_kind]}
              </span>
              <span style={{ fontSize: 11, opacity: 0.55 }}>{formatShortDate(e.match_date)}</span>
              <span style={{ fontSize: 11, opacity: 0.4 }}>·</span>
              <span style={{ fontSize: 11, opacity: 0.55 }}>{timeGap(e.source_date, e.match_date)}</span>
              <span style={{ flex: 1 }} />
              <SimilarityDots value={e.similarity} />
              <span style={{ fontSize: 11, opacity: 0.5 }}>{e.similarity}/5</span>
            </div>

            <div style={{ fontStyle: "italic", fontSize: 13, opacity: 0.9, fontFamily: "Georgia, serif" }}>
              “{e.match_text_excerpt.length > 320 ? e.match_text_excerpt.slice(0, 320) + "…" : e.match_text_excerpt}”
            </div>

            <div
              style={{
                fontSize: 12,
                fontStyle: "italic",
                padding: "8px 12px",
                borderLeft: "2px solid #9aa28e",
                background: "rgba(154,162,142,0.08)",
                borderRadius: "0 6px 6px 0",
                color: "rgba(255,255,255,0.85)",
              }}
            >
              {e.similarity_note}
            </div>

            {e.user_note && editingId !== e.id && (
              <div style={{ fontSize: 12, padding: "8px 12px", borderLeft: "2px solid #fbb86d", background: "rgba(251,184,108,0.06)", borderRadius: "0 6px 6px 0", color: "rgba(255,255,255,0.82)" }}>
                <span style={{ opacity: 0.5, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Note</span>
                {e.user_note}
              </div>
            )}

            {editingId === e.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea
                  value={editNote}
                  onChange={(ev) => setEditNote(ev.target.value)}
                  placeholder="What's keeping this loop alive? What would break it?"
                  rows={3}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    padding: 10,
                    color: "#fff",
                    fontSize: 13,
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => saveNote(e.id)} style={btnSecondary}>Save</button>
                  <button type="button" onClick={() => { setEditingId(null); setEditNote(""); }} style={btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => { setEditingId(e.id); setEditNote(e.user_note ?? ""); }}
                  style={btnGhost}
                >
                  {e.user_note ? "Edit note" : "Add note"}
                </button>
                {e.dismissed_at ? (
                  <button type="button" onClick={() => dismiss(e.id, false)} style={btnGhost}>Restore</button>
                ) : (
                  <button type="button" onClick={() => dismiss(e.id, true)} style={btnGhost}>Dismiss</button>
                )}
                <button type="button" onClick={() => remove(e.id)} style={{ ...btnGhost, color: "#f4a3a3" }}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 12,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "transparent",
  color: "rgba(255,255,255,0.65)",
  fontSize: 11,
  cursor: "pointer",
};
