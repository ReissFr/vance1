"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ImplicitBelief = { belief: string; evidence: string | null; confidence: number };
type Conflict = { implicit: string; stated: string; tension_note: string };

type ReverseBrief = {
  id: string;
  brief_date: string;
  implicit_beliefs: ImplicitBelief[];
  summary: string;
  conflicts: Conflict[];
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  latency_ms: number | null;
  model: string | null;
  user_status: "acknowledged" | "contested" | "dismissed" | null;
  user_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
};

type Status = "open" | "acknowledged" | "contested" | "dismissed" | "archived" | "all";

function relDate(iso: string): string {
  const today = new Date();
  const target = new Date(iso + "T12:00:00.000Z");
  const days = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

function dayOfWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00.000Z");
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

function dotMeter(score: number, color = "#fbb86d"): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 6, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReverseBriefsConsole() {
  const [rows, setRows] = useState<ReverseBrief[]>([]);
  const [status, setStatus] = useState<Status>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDate, setComposeDate] = useState<string>(todayDateStr());
  const [generating, setGenerating] = useState(false);

  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/reverse-briefs?status=${status}&limit=100`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { reverse_briefs: ReverseBrief[] };
      setRows(j.reverse_briefs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/reverse-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief_date: composeDate }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setComposeOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/reverse-briefs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this brief permanently?")) return;
    setError(null);
    try {
      const r = await fetch(`/api/reverse-briefs/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = useMemo(() => ({
    open: rows.filter((r) => r.user_status == null && r.archived_at == null).length,
    acknowledged: rows.filter((r) => r.user_status === "acknowledged").length,
    contested: rows.filter((r) => r.user_status === "contested").length,
    dismissed: rows.filter((r) => r.user_status === "dismissed").length,
    archived: rows.filter((r) => r.archived_at != null).length,
  }), [rows]);

  const STATUS_TABS: Array<{ id: Status; label: string; count?: number }> = [
    { id: "open", label: "Open", count: counts.open },
    { id: "acknowledged", label: "Acknowledged", count: counts.acknowledged },
    { id: "contested", label: "Contested", count: counts.contested },
    { id: "dismissed", label: "Dismissed", count: counts.dismissed },
    { id: "archived", label: "Archived", count: counts.archived },
    { id: "all", label: "All" },
  ];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", color: "#e8e0d2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <button
          onClick={() => { setComposeDate(todayDateStr()); setComposeOpen(true); }}
          style={{
            background: "#fbb86d",
            color: "#1a1612",
            border: "none",
            padding: "10px 16px",
            borderRadius: 4,
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.02em",
          }}
        >
          REVERSE-ENGINEER A DAY
        </button>
        <span style={{ color: "#7a7268", fontSize: 12 }}>
          read a single day&apos;s actions and infer what you must have implicitly believed
        </span>
      </div>

      {error && (
        <div style={{ background: "#3a1a1a", color: "#ff9b8e", padding: "10px 14px", borderRadius: 4, marginBottom: 16, fontSize: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setStatus(t.id)}
            style={{
              background: status === t.id ? "#2a2620" : "transparent",
              color: status === t.id ? "#e8e0d2" : "#7a7268",
              border: `1px solid ${status === t.id ? "#4a4238" : "#2a2620"}`,
              padding: "6px 12px",
              borderRadius: 4,
              fontFamily: "inherit",
              fontSize: 12,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {t.label}{typeof t.count === "number" && t.count > 0 ? ` ${t.count}` : ""}
          </button>
        ))}
      </div>

      {loading && rows.length === 0 && (
        <div style={{ color: "#7a7268", fontSize: 13, padding: 20 }}>loading...</div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{ color: "#7a7268", fontSize: 13, padding: 20, fontStyle: "italic" }}>
          no briefs yet. generate one to surface what your day&apos;s actions reveal you implicitly believed.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {rows.map((b) => {
          const isOpen = b.user_status == null && b.archived_at == null;
          const hasConflicts = b.conflicts && b.conflicts.length > 0;
          return (
            <div
              key={b.id}
              style={{
                background: "#1a1612",
                borderLeft: `3px solid ${hasConflicts ? "#fbb86d" : "#bfd4ee"}`,
                padding: "16px 20px",
                borderRadius: "0 4px 4px 0",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span style={{ color: "#e8e0d2", fontFamily: "Georgia, serif", fontSize: 18 }}>{b.brief_date}</span>
                  <span style={{ color: "#7a7268", fontSize: 12 }}>{dayOfWeek(b.brief_date)} · {relDate(b.brief_date)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {b.user_status && (
                    <span style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 3,
                      letterSpacing: "0.04em",
                      background: b.user_status === "acknowledged" ? "#1f3a2c" : b.user_status === "contested" ? "#3a2c1a" : "#2a2620",
                      color: b.user_status === "acknowledged" ? "#7affcb" : b.user_status === "contested" ? "#fbb86d" : "#7a7268",
                      textTransform: "uppercase",
                    }}>
                      {b.user_status}
                    </span>
                  )}
                  {b.pinned && <span style={{ color: "#fbb86d", fontSize: 13 }}>pinned</span>}
                </div>
              </div>

              <div style={{ fontFamily: "Georgia, serif", fontSize: 16, lineHeight: 1.6, color: "#e8e0d2", marginBottom: 16 }}>
                {b.summary}
              </div>

              {b.implicit_beliefs && b.implicit_beliefs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#7a7268", fontSize: 10, letterSpacing: "0.08em", marginBottom: 8 }}>IMPLICIT BELIEFS YOU WERE OPERATING FROM</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {b.implicit_beliefs.map((ib, i) => (
                      <div key={i} style={{ paddingLeft: 12, borderLeft: "1px solid #2a2620" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                          {dotMeter(ib.confidence)}
                          <span style={{ fontFamily: "Georgia, serif", fontSize: 14, lineHeight: 1.5, color: "#e8e0d2" }}>{ib.belief}</span>
                        </div>
                        {ib.evidence && (
                          <div style={{ fontSize: 11, color: "#9aa28e", fontStyle: "italic", lineHeight: 1.5, paddingLeft: 22 }}>
                            evidence — {ib.evidence}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasConflicts && (
                <div style={{ marginBottom: 14, background: "#2a2014", borderLeft: "2px solid #fbb86d", padding: "10px 14px", borderRadius: "0 3px 3px 0" }}>
                  <div style={{ color: "#fbb86d", fontSize: 10, letterSpacing: "0.08em", marginBottom: 8 }}>CONFLICTS WITH YOUR STATED IDENTITY</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {b.conflicts.map((c, i) => (
                      <div key={i}>
                        <div style={{ fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.5, color: "#fbb86d", marginBottom: 4 }}>{c.tension_note}</div>
                        <div style={{ fontSize: 11, color: "#9aa28e", lineHeight: 1.5, fontStyle: "italic" }}>
                          stated &mdash; {c.stated}<br/>implicit &mdash; {c.implicit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.source_summary && (
                <div style={{ color: "#7a7268", fontSize: 10, marginBottom: 12, fontStyle: "italic" }}>
                  {b.source_summary} · {b.latency_ms != null ? `${(b.latency_ms / 1000).toFixed(1)}s` : ""}{b.model ? ` · ${b.model.split("-").slice(0, 2).join("-")}` : ""}
                </div>
              )}

              {b.user_note && (
                <div style={{ background: "#1f1a14", padding: "8px 12px", borderRadius: 3, fontSize: 12, color: "#9aa28e", marginBottom: 12, fontStyle: "italic", lineHeight: 1.5 }}>
                  &ldquo;{b.user_note}&rdquo;
                </div>
              )}

              {noteOpenId === b.id ? (
                <div style={{ marginBottom: 12 }}>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="your reaction — what was actually driving the day?"
                    rows={3}
                    style={{ width: "100%", background: "#1a1612", color: "#e8e0d2", border: "1px solid #2a2620", padding: 8, fontFamily: "inherit", fontSize: 12, borderRadius: 3, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      onClick={async () => {
                        if (noteDraft.trim()) await patch(b.id, { user_note: noteDraft.trim() });
                        setNoteOpenId(null);
                        setNoteDraft("");
                      }}
                      style={{ background: "#2a2620", color: "#e8e0d2", border: "1px solid #4a4238", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      save
                    </button>
                    <button
                      onClick={() => { setNoteOpenId(null); setNoteDraft(""); }}
                      style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {isOpen && (
                  <>
                    <button
                      onClick={() => patch(b.id, { status: "acknowledged" })}
                      style={{ background: "transparent", color: "#7affcb", border: "1px solid #7affcb", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3, letterSpacing: "0.02em" }}
                    >
                      acknowledge
                    </button>
                    <button
                      onClick={() => patch(b.id, { status: "contested" })}
                      style={{ background: "transparent", color: "#fbb86d", border: "1px solid #fbb86d", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3, letterSpacing: "0.02em" }}
                    >
                      contest
                    </button>
                    <button
                      onClick={() => patch(b.id, { status: "dismissed" })}
                      style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3, letterSpacing: "0.02em" }}
                    >
                      dismiss
                    </button>
                  </>
                )}
                {noteOpenId !== b.id && (
                  <button
                    onClick={() => { setNoteOpenId(b.id); setNoteDraft(b.user_note ?? ""); }}
                    style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                  >
                    {b.user_note ? "edit note" : "+ note"}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => patch(b.id, { pin: !b.pinned })}
                  style={{ background: "transparent", color: b.pinned ? "#fbb86d" : "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                >
                  {b.pinned ? "unpin" : "pin"}
                </button>
                <button
                  onClick={() => patch(b.id, b.archived_at ? { restore: true } : { archive: true })}
                  style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                >
                  {b.archived_at ? "restore" : "archive"}
                </button>
                <button
                  onClick={() => remove(b.id)}
                  style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                >
                  delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {composeOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !generating) setComposeOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}
        >
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", borderRadius: 6, padding: 24, width: 460, maxWidth: "90vw" }}>
            <div style={{ color: "#e8e0d2", fontSize: 14, marginBottom: 14, letterSpacing: "0.02em" }}>REVERSE-ENGINEER A DAY</div>
            <div style={{ color: "#7a7268", fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
              picks up that day&apos;s intentions, standup, check-in, decisions, reflections, wins and commitments handled, then infers what you must have implicitly believed for it all to make sense. takes 4-8 seconds.
            </div>

            <label style={{ color: "#9aa28e", fontSize: 11, display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>DATE</label>
            <input
              type="date"
              value={composeDate}
              max={todayDateStr()}
              onChange={(e) => setComposeDate(e.target.value)}
              style={{ width: "100%", background: "#0e0c0a", color: "#e8e0d2", border: "1px solid #2a2620", padding: 8, fontFamily: "inherit", fontSize: 13, borderRadius: 3, marginBottom: 10, colorScheme: "dark" }}
            />

            <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
              {[0, 1, 2, 3, 7].map((d) => {
                const dt = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
                const label = d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
                return (
                  <button
                    key={d}
                    onClick={() => setComposeDate(dt)}
                    style={{ background: composeDate === dt ? "#2a2620" : "transparent", color: composeDate === dt ? "#e8e0d2" : "#7a7268", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setComposeOpen(false)}
                disabled={generating}
                style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "8px 14px", fontSize: 12, fontFamily: "inherit", cursor: generating ? "default" : "pointer", borderRadius: 3 }}
              >
                cancel
              </button>
              <button
                onClick={generate}
                disabled={generating || !composeDate}
                style={{ background: "#fbb86d", color: "#1a1612", border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: generating ? "default" : "pointer", borderRadius: 3, letterSpacing: "0.02em", opacity: generating ? 0.6 : 1 }}
              >
                {generating ? "READING..." : "REVERSE-ENGINEER"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
