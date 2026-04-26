"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Chapter = {
  ordinal: number;
  title: string;
  narrative: string;
  start_date: string;
  end_date: string | null;
  themes: string[];
  key_decision_ids: string[];
  key_win_ids: string[];
};

type Timeline = {
  id: string;
  chapters: Chapter[];
  drift_summary: string | null;
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  earliest_date: string | null;
  latest_date: string | null;
  parent_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Status = "active" | "pinned" | "archived" | "all";

const WINDOW_OPTIONS = [
  { days: 365, label: "1y" },
  { days: 730, label: "2y" },
  { days: 1095, label: "3y" },
  { days: 1825, label: "5y" },
  { days: 3650, label: "all" },
];

function dateOnly(iso: string): string { return iso.slice(0, 10); }

function chapterDays(c: Chapter): number {
  const start = new Date(c.start_date + "T00:00:00Z").getTime();
  const end = c.end_date ? new Date(c.end_date + "T00:00:00Z").getTime() : Date.now();
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
}

function fmtRange(start: string, end: string | null): string {
  if (!end) return `${start} → now`;
  return `${start} → ${end}`;
}

export function LifeTimelineConsole() {
  const [rows, setRows] = useState<Timeline[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [windowDays, setWindowDays] = useState<number>(1095);
  const [stitching, setStitching] = useState(false);

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/life-timelines?status=${status}&limit=20`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { timelines: Timeline[] };
      setRows(j.timelines ?? []);
      const first = j.timelines?.[0];
      if (first && (!activeId || !j.timelines.some((t) => t.id === activeId))) {
        setActiveId(first.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, activeId]);

  useEffect(() => { load(); }, [load]);

  const stitch = useCallback(async () => {
    setStitching(true);
    setError(null);
    try {
      const r = await fetch("/api/life-timelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = (await r.json()) as { timeline?: Timeline; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (j.timeline) setActiveId(j.timeline.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStitching(false);
    }
  }, [windowDays, load]);

  const togglePin = useCallback(async (t: Timeline) => {
    await fetch(`/api/life-timelines/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: !t.pinned }),
    });
    await load();
  }, [load]);

  const archive = useCallback(async (t: Timeline) => {
    await fetch(`/api/life-timelines/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: true }),
    });
    await load();
  }, [load]);

  const restore = useCallback(async (t: Timeline) => {
    await fetch(`/api/life-timelines/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: true }),
    });
    await load();
  }, [load]);

  const remove = useCallback(async (t: Timeline) => {
    if (!confirm("Delete this timeline permanently?")) return;
    await fetch(`/api/life-timelines/${t.id}`, { method: "DELETE" });
    setActiveId(null);
    await load();
  }, [load]);

  const saveNote = useCallback(async () => {
    if (!activeId) return;
    setSavingNote(true);
    try {
      await fetch(`/api/life-timelines/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_note: noteDraft }),
      });
      setEditingNote(false);
      await load();
    } finally {
      setSavingNote(false);
    }
  }, [activeId, noteDraft, load]);

  const active = useMemo(() => rows.find((r) => r.id === activeId) ?? null, [rows, activeId]);

  const totalSpan = useMemo(() => {
    if (!active || !active.earliest_date || !active.latest_date) return 0;
    return Math.max(1, Math.round(
      (new Date(active.latest_date + "T00:00:00Z").getTime() -
        new Date(active.earliest_date + "T00:00:00Z").getTime()) / 86_400_000
    ));
  }, [active]);

  const STATUSES: { value: Status; label: string }[] = [
    { value: "active", label: "active" },
    { value: "pinned", label: "pinned" },
    { value: "archived", label: "archived" },
    { value: "all", label: "all" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#e8e0d2" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 10, color: "#9aa28e", letterSpacing: 1, marginBottom: 8 }}>WINDOW</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w.days}
                onClick={() => setWindowDays(w.days)}
                style={{
                  padding: "4px 10px",
                  background: windowDays === w.days ? "#2a2620" : "transparent",
                  color: windowDays === w.days ? "#bfd4ee" : "#9aa28e",
                  border: `1px solid ${windowDays === w.days ? "#bfd4ee" : "#2a2620"}`,
                  borderRadius: 3,
                  fontSize: 11,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            onClick={stitch}
            disabled={stitching}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "#0e0c08",
              color: "#bfd4ee",
              border: "1px solid #bfd4ee",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "inherit",
              cursor: stitching ? "wait" : "pointer",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {stitching ? "…stitching" : "Stitch timeline"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              style={{
                padding: "3px 8px",
                background: status === s.value ? "#2a2620" : "transparent",
                color: status === s.value ? "#e8e0d2" : "#9aa28e",
                border: `1px solid ${status === s.value ? "#5c5a52" : "#2a2620"}`,
                borderRadius: 3,
                fontSize: 10,
                fontFamily: "inherit",
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "70vh", overflowY: "auto" }}>
          {rows.map((r) => {
            const isActive = r.id === activeId;
            return (
              <button
                key={r.id}
                onClick={() => setActiveId(r.id)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  background: isActive ? "#2a2620" : "#1a1813",
                  border: `1px solid ${isActive ? "#5c5a52" : "#2a2620"}`,
                  borderLeft: r.pinned ? "3px solid #fbb86d" : `1px solid ${isActive ? "#5c5a52" : "#2a2620"}`,
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "#e8e0d2",
                }}
              >
                <div style={{ fontSize: 11, color: isActive ? "#bfd4ee" : "#e8e0d2" }}>{dateOnly(r.created_at)}</div>
                <div style={{ fontSize: 10, color: "#9aa28e", marginTop: 2 }}>
                  {r.chapters?.length ?? 0} chapters
                </div>
                <div style={{ fontSize: 9, color: "#5c5a52", marginTop: 2 }}>
                  {r.earliest_date} → {r.latest_date}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {error && (
          <div style={{ background: "#2a1010", border: "1px solid #ff6b6b", color: "#ff6b6b", padding: 10, borderRadius: 4, fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading && !active ? (
          <div style={{ color: "#9aa28e", fontSize: 12 }}>loading…</div>
        ) : !active ? (
          <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderRadius: 6, padding: 32, textAlign: "center", color: "#9aa28e", fontSize: 13 }}>
            No timelines yet. Pick a window and stitch your first one.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: "#9aa28e" }}>STITCHED {dateOnly(active.created_at)} · {relTime(active.created_at)}</div>
                <div style={{ fontSize: 13, color: "#e8e0d2", marginTop: 2 }}>
                  {active.chapters.length} chapters across {active.earliest_date} → {active.latest_date}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => togglePin(active)}
                  style={{ padding: "5px 10px", background: "transparent", color: active.pinned ? "#fbb86d" : "#9aa28e", border: `1px solid ${active.pinned ? "#fbb86d" : "#2a2620"}`, borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                >
                  {active.pinned ? "Unpin" : "Pin"}
                </button>
                {active.archived_at ? (
                  <button onClick={() => restore(active)} style={{ padding: "5px 10px", background: "transparent", color: "#9aa28e", border: "1px solid #2a2620", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                    Restore
                  </button>
                ) : (
                  <button onClick={() => archive(active)} style={{ padding: "5px 10px", background: "transparent", color: "#9aa28e", border: "1px solid #2a2620", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                    Archive
                  </button>
                )}
                <button onClick={() => remove(active)} style={{ padding: "5px 10px", background: "transparent", color: "#5c5a52", border: "1px solid #2a2620", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                  Delete
                </button>
              </div>
            </div>

            {active.drift_summary && (
              <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderLeft: "3px solid #fbb86d", borderRadius: 4, padding: 12 }}>
                <div style={{ fontSize: 10, color: "#fbb86d", letterSpacing: 1, marginBottom: 4 }}>DRIFT</div>
                <div style={{ fontSize: 13, color: "#e8e0d2", fontStyle: "italic", lineHeight: 1.6 }}>{active.drift_summary}</div>
              </div>
            )}

            {/* Visual proportional band: each chapter gets width proportional to its day-span */}
            {totalSpan > 0 && (
              <div style={{ display: "flex", height: 8, borderRadius: 2, overflow: "hidden", background: "#0e0c08" }}>
                {active.chapters.map((c, i) => {
                  const days = chapterDays(c);
                  const pct = (days / totalSpan) * 100;
                  const colors = ["#bfd4ee", "#fbb86d", "#7affcb", "#f4c9d8", "#9aa28e", "#e8e0d2", "#bfd4ee"];
                  return (
                    <div
                      key={c.ordinal}
                      title={`${c.title} (${days}d)`}
                      style={{ width: `${pct}%`, background: colors[i % colors.length], borderRight: i < active.chapters.length - 1 ? "1px solid #0e0c08" : undefined }}
                    />
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {active.chapters.map((c, i) => {
                const colors = ["#bfd4ee", "#fbb86d", "#7affcb", "#f4c9d8", "#9aa28e", "#e8e0d2", "#bfd4ee"];
                const color = colors[i % colors.length] ?? "#e8e0d2";
                const days = chapterDays(c);
                return (
                  <div key={c.ordinal} style={{ background: "#1a1813", border: "1px solid #2a2620", borderLeft: `3px solid ${color}`, borderRadius: 4, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "#5c5a52", letterSpacing: 1 }}>CH {c.ordinal}</span>
                        <span style={{ fontSize: 16, color, fontFamily: "Georgia, serif" }}>{c.title}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#9aa28e" }}>
                        {fmtRange(c.start_date, c.end_date)} · {days}d
                      </div>
                    </div>
                    <div style={{ fontSize: 14, color: "#e8e0d2", fontFamily: "Georgia, serif", lineHeight: 1.7 }}>
                      {c.narrative}
                    </div>
                    {c.themes.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {c.themes.map((t) => (
                          <span key={t} style={{ fontSize: 10, color: "#fbb86d", padding: "2px 8px", border: "1px solid #fbb86d", borderRadius: 999 }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {(c.key_decision_ids.length > 0 || c.key_win_ids.length > 0) && (
                      <div style={{ fontSize: 10, color: "#5c5a52", marginTop: 8 }}>
                        {c.key_decision_ids.length > 0 && <span>{c.key_decision_ids.length} key decisions</span>}
                        {c.key_decision_ids.length > 0 && c.key_win_ids.length > 0 && " · "}
                        {c.key_win_ids.length > 0 && <span>{c.key_win_ids.length} key wins</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {active.source_summary && (
              <div style={{ fontSize: 11, color: "#5c5a52", fontStyle: "italic" }}>
                {active.source_summary}
              </div>
            )}

            <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderRadius: 4, padding: 12 }}>
              <div style={{ fontSize: 10, color: "#9aa28e", letterSpacing: 1, marginBottom: 6 }}>YOUR REACTION</div>
              {editingNote ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    style={{ background: "#0e0c08", color: "#e8e0d2", border: "1px solid #2a2620", borderRadius: 3, padding: 8, fontSize: 12, fontFamily: "inherit", resize: "vertical" }}
                    placeholder="yes that's me · no that misses the X chapter · this gives me chills · …"
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={saveNote} disabled={savingNote} style={{ padding: "6px 12px", background: "#0e0c08", color: "#7affcb", border: "1px solid #7affcb", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: savingNote ? "wait" : "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                      {savingNote ? "…saving" : "Save"}
                    </button>
                    <button onClick={() => setEditingNote(false)} style={{ padding: "6px 12px", background: "transparent", color: "#9aa28e", border: "1px solid #2a2620", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : active.user_note ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontSize: 13, color: "#e8e0d2", fontStyle: "italic", lineHeight: 1.6 }}>{active.user_note}</div>
                  <button onClick={() => { setNoteDraft(active.user_note ?? ""); setEditingNote(true); }} style={{ padding: "4px 10px", background: "transparent", color: "#9aa28e", border: "1px solid #2a2620", borderRadius: 3, fontSize: 10, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                    Edit
                  </button>
                </div>
              ) : (
                <button onClick={() => { setNoteDraft(""); setEditingNote(true); }} style={{ padding: "5px 10px", background: "transparent", color: "#bfd4ee", border: "1px solid #bfd4ee", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}>
                  + React
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
