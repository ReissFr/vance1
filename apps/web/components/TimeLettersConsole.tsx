"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Letter = {
  id: string;
  kind: "forward" | "backward" | "posterity";
  title: string;
  body: string;
  written_at_date: string;
  target_date: string | null;
  delivered_at: string | null;
  delivered_via: string | null;
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  latency_ms: number | null;
  model: string | null;
  user_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

type Tab = "pending" | "delivered" | "backward" | "posterity" | "archived";
type ComposeMode = "forward" | "backward" | "posterity" | null;

const KIND_TINT: Record<Letter["kind"], string> = {
  forward: "#bfd4ee",
  backward: "#fbb86d",
  posterity: "#f4c9d8",
};

const KIND_LABEL: Record<Letter["kind"], string> = {
  forward: "FORWARD",
  backward: "BACKWARD",
  posterity: "POSTERITY",
};

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

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
  if (day < 365 * 2) return `${Math.round(day / 30)}mo ago`;
  return `${(day / 365).toFixed(1)}y ago`;
}

function relDate(iso: string): string {
  const today = todayStr();
  const ms = new Date(iso + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 14) return `in ${days}d`;
  if (days > 1 && days < 90) return `in ${Math.round(days / 7)}w`;
  if (days > 1 && days < 365 * 2) return `in ${Math.round(days / 30)}mo`;
  if (days > 1) return `in ${(days / 365).toFixed(1)}y`;
  if (days < 0 && days > -14) return `${-days}d ago`;
  if (days < 0 && days > -90) return `${Math.round(-days / 7)}w ago`;
  if (days < 0 && days > -365 * 2) return `${Math.round(-days / 30)}mo ago`;
  return `${(-days / 365).toFixed(1)}y ago`;
}

export function TimeLettersConsole() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [composeMode, setComposeMode] = useState<ComposeMode>(null);
  const [savingCompose, setSavingCompose] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeTarget, setComposeTarget] = useState(plusDays(180));
  const [composeWrittenAt, setComposeWrittenAt] = useState(plusDays(-365));
  const [composeWindow, setComposeWindow] = useState(60);

  const [openId, setOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/time-letters?status=all&limit=80`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { letters: Letter[] };
      setLetters(j.letters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    return letters.filter((l) => {
      if (tab === "archived") return l.archived_at != null;
      if (l.archived_at != null) return false;
      if (tab === "pending") return l.kind === "forward" && l.delivered_at == null && l.cancelled_at == null;
      if (tab === "delivered") return l.kind === "forward" && l.delivered_at != null;
      if (tab === "backward") return l.kind === "backward";
      if (tab === "posterity") return l.kind === "posterity";
      return true;
    });
  }, [letters, tab]);

  const counts = useMemo(() => {
    const c = { pending: 0, delivered: 0, backward: 0, posterity: 0, archived: 0 };
    for (const l of letters) {
      if (l.archived_at != null) { c.archived += 1; continue; }
      if (l.kind === "forward" && l.delivered_at == null && l.cancelled_at == null) c.pending += 1;
      if (l.kind === "forward" && l.delivered_at != null) c.delivered += 1;
      if (l.kind === "backward") c.backward += 1;
      if (l.kind === "posterity") c.posterity += 1;
    }
    return c;
  }, [letters]);

  const startCompose = (mode: NonNullable<ComposeMode>) => {
    setComposeMode(mode);
    setComposeTitle("");
    setComposeBody("");
    setComposeTarget(plusDays(180));
    setComposeWrittenAt(plusDays(-365));
    setComposeWindow(60);
  };

  const submitCompose = async () => {
    if (!composeMode) return;
    setSavingCompose(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { kind: composeMode };
      if (composeMode === "forward") {
        if (!composeTitle.trim() || !composeBody.trim()) throw new Error("title and body required");
        body.title = composeTitle.trim();
        body.body = composeBody.trim();
        body.target_date = composeTarget;
      } else if (composeMode === "posterity") {
        if (!composeTitle.trim() || !composeBody.trim()) throw new Error("title and body required");
        body.title = composeTitle.trim();
        body.body = composeBody.trim();
        body.written_at_date = composeWrittenAt;
      } else if (composeMode === "backward") {
        body.written_at_date = composeWrittenAt;
        body.window_days = composeWindow;
      }
      const r = await fetch("/api/time-letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { letter: Letter };
      setLetters((prev) => [j.letter, ...prev]);
      setComposeMode(null);
      if (composeMode === "forward") setTab("pending");
      else if (composeMode === "backward") setTab("backward");
      else setTab("posterity");
      setOpenId(j.letter.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCompose(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/time-letters/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { letter: Letter };
      setLetters((prev) => prev.map((l) => (l.id === id ? j.letter : l)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this letter forever?")) return;
    setError(null);
    try {
      const r = await fetch(`/api/time-letters/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setLetters((prev) => prev.filter((l) => l.id !== id));
      if (openId === id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tabPills: Array<{ id: Tab; label: string; count: number }> = [
    { id: "pending", label: "Pending", count: counts.pending },
    { id: "delivered", label: "Delivered", count: counts.delivered },
    { id: "backward", label: "From the past", count: counts.backward },
    { id: "posterity", label: "Posterity", count: counts.posterity },
    { id: "archived", label: "Archived", count: counts.archived },
  ];

  return (
    <div style={{ padding: "8px 14px 28px", color: "#e8e0d2", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 13 }}>
      {/* Compose actions */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => startCompose("forward")} style={btn("#bfd4ee")}>Seal a forward letter</button>
        <button onClick={() => startCompose("backward")} style={btn("#fbb86d")}>Generate from the past</button>
        <button onClick={() => startCompose("posterity")} style={btn("#f4c9d8")}>Write to a past you</button>
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.55, fontSize: 11 }}>{letters.length} letters total</span>
      </div>

      {error && <div style={{ background: "#3a1a1a", border: "1px solid #ff6b6b", color: "#ffb0b0", padding: "8px 12px", borderRadius: 6, marginBottom: 14, fontSize: 12 }}>{error}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, borderBottom: "1px solid #2a2620", paddingBottom: 10 }}>
        {tabPills.map((p) => (
          <button
            key={p.id}
            onClick={() => setTab(p.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 14,
              border: "1px solid #2a2620",
              background: tab === p.id ? "#bfd4ee" : "transparent",
              color: tab === p.id ? "#1a1612" : "#e8e0d2",
              fontFamily: "inherit",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.label} <span style={{ opacity: 0.5, marginLeft: 4 }}>{p.count}</span>
          </button>
        ))}
      </div>

      {/* Compose modal */}
      {composeMode != null && (
        <div onClick={() => !savingCompose && setComposeMode(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#181410", border: "1px solid " + KIND_TINT[composeMode], borderRadius: 8, padding: "20px 22px", width: "min(640px, 90vw)", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
              <span style={{ color: KIND_TINT[composeMode], fontSize: 11, letterSpacing: 1 }}>{KIND_LABEL[composeMode]}</span>
              <span style={{ color: "#e8e0d2", fontSize: 14 }}>
                {composeMode === "forward" && "Seal a letter for your future self"}
                {composeMode === "backward" && "Generate a letter from your past self"}
                {composeMode === "posterity" && "Write a letter to a past version of you"}
              </span>
            </div>

            {(composeMode === "forward" || composeMode === "posterity") && (
              <>
                <label style={lbl}>Title</label>
                <input value={composeTitle} onChange={(e) => setComposeTitle(e.target.value)} placeholder="3-8 words" style={inp} />
                <label style={lbl}>Body</label>
                <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={10} placeholder={composeMode === "forward" ? "Write what you want your future self to read..." : "Write what you wish you'd told yourself back then..."} style={{ ...inp, fontFamily: "Georgia, serif", lineHeight: 1.6, resize: "vertical" }} />
              </>
            )}

            {composeMode === "forward" && (
              <>
                <label style={lbl}>Deliver on</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="date" value={composeTarget} onChange={(e) => setComposeTarget(e.target.value)} min={plusDays(1)} style={{ ...inp, width: 180, marginBottom: 0 }} />
                  <span style={{ opacity: 0.55, fontSize: 11 }}>{relDate(composeTarget)}</span>
                  <span style={{ flex: 1 }} />
                  {[7, 30, 90, 180, 365].map((d) => (
                    <button key={d} onClick={() => setComposeTarget(plusDays(d))} style={chip(composeTarget === plusDays(d))}>+{d}d</button>
                  ))}
                </div>
                <p style={{ opacity: 0.55, fontSize: 11, marginTop: 12 }}>The letter is sealed now and delivered via WhatsApp on the target date. You won't see the body again until then.</p>
              </>
            )}

            {composeMode === "posterity" && (
              <>
                <label style={lbl}>Addressed to you on</label>
                <input type="date" value={composeWrittenAt} onChange={(e) => setComposeWrittenAt(e.target.value)} max={plusDays(-1)} style={{ ...inp, width: 180 }} />
                <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 8 }}>{relDate(composeWrittenAt)}</span>
              </>
            )}

            {composeMode === "backward" && (
              <>
                <label style={lbl}>Voice the letter from</label>
                <input type="date" value={composeWrittenAt} onChange={(e) => setComposeWrittenAt(e.target.value)} max={plusDays(-7)} style={{ ...inp, width: 180 }} />
                <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 8 }}>{relDate(composeWrittenAt)}</span>
                <label style={lbl}>Window leading up to that date</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[14, 30, 60, 90, 180].map((d) => (
                    <button key={d} onClick={() => setComposeWindow(d)} style={chip(composeWindow === d)}>{d}d</button>
                  ))}
                </div>
                <p style={{ opacity: 0.55, fontSize: 11, marginTop: 12 }}>JARVIS reads your reflections, decisions, wins, standups, and check-ins from the {composeWindow} days before {composeWrittenAt} and writes a letter as if voiced by you on that day. Quotes actual entries.</p>
              </>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button disabled={savingCompose} onClick={submitCompose} style={btn(KIND_TINT[composeMode])}>
                {savingCompose ? (composeMode === "backward" ? "Generating…" : "Sealing…") : (composeMode === "forward" ? "Seal" : composeMode === "backward" ? "Generate" : "Save")}
              </button>
              <button disabled={savingCompose} onClick={() => setComposeMode(null)} style={{ ...btn("#3a3530"), color: "#e8e0d2" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ opacity: 0.55, fontSize: 12 }}>Loading letters…</div>
      ) : filtered.length === 0 ? (
        <div style={{ opacity: 0.55, fontSize: 12, padding: "30px 0" }}>
          {tab === "pending" && "No sealed letters waiting. Seal one for your future self."}
          {tab === "delivered" && "No letters have been delivered yet. The first one arrives on its target date."}
          {tab === "backward" && "No past-self letters generated yet. Pick a past date and let JARVIS write what you might have written."}
          {tab === "posterity" && "No posterity letters written yet. These are letters TO a past version of you, kept here for you to revisit."}
          {tab === "archived" && "No archived letters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((l) => {
            const open = openId === l.id;
            const isPendingForward = l.kind === "forward" && l.delivered_at == null && l.cancelled_at == null;
            return (
              <div key={l.id} style={{
                borderLeft: `3px solid ${KIND_TINT[l.kind]}`,
                background: "#16120e",
                padding: "12px 16px",
                borderRadius: 4,
                opacity: l.archived_at ? 0.55 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: KIND_TINT[l.kind], fontSize: 10, letterSpacing: 1 }}>{KIND_LABEL[l.kind]}</span>
                  {l.kind === "forward" && (
                    <span style={{ fontSize: 11, opacity: 0.7 }}>
                      {l.delivered_at ? `delivered ${relTime(l.delivered_at)}` : l.cancelled_at ? `cancelled ${relTime(l.cancelled_at)}` : `unlocks ${relDate(l.target_date ?? "")}`}
                    </span>
                  )}
                  {l.kind === "backward" && <span style={{ fontSize: 11, opacity: 0.7 }}>voiced from {l.written_at_date} ({relDate(l.written_at_date)})</span>}
                  {l.kind === "posterity" && <span style={{ fontSize: 11, opacity: 0.7 }}>to you on {l.written_at_date} ({relDate(l.written_at_date)})</span>}
                  {l.pinned && <span style={{ color: "#f4c9d8", fontSize: 11 }}>★ pinned</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ opacity: 0.45, fontSize: 10 }}>sealed {relTime(l.created_at)}</span>
                </div>

                <div style={{ marginTop: 8, fontFamily: "Georgia, serif", fontSize: 17, lineHeight: 1.3, color: "#e8e0d2" }}>{l.title}</div>

                {/* Body — hidden for pending forwards (so seal feels real) */}
                {isPendingForward && !open ? (
                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6, fontStyle: "italic" }}>
                    Sealed. Body hidden until {l.target_date} ({relDate(l.target_date ?? "")}).
                    <button onClick={() => { setOpenId(open ? null : l.id); setNoteDraft(l.user_note ?? ""); }} style={{ ...btn("transparent"), color: "#bfd4ee", border: "1px solid #2a2620", marginLeft: 12, padding: "2px 10px", fontSize: 10 }}>Peek anyway</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontFamily: "Georgia, serif", fontSize: 14, lineHeight: 1.7, color: "#cfc7b8", whiteSpace: "pre-wrap" }}>
                    {l.body}
                  </div>
                )}

                {l.source_summary && (
                  <div style={{ marginTop: 10, fontSize: 11, fontStyle: "italic", opacity: 0.55 }}>{l.source_summary}{l.latency_ms ? ` · ${(l.latency_ms / 1000).toFixed(1)}s` : ""}</div>
                )}

                {/* User note */}
                {l.delivered_at != null && (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "#0e0c0a", borderRadius: 4, border: "1px solid #2a2620" }}>
                    <div style={{ fontSize: 10, letterSpacing: 1, opacity: 0.6, marginBottom: 6 }}>YOUR REACTION</div>
                    {open ? (
                      <>
                        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="Were you right? Wrong? Forgotten?" style={{ ...inp, fontFamily: "Georgia, serif" }} />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={async () => { await patch(l.id, { user_note: noteDraft }); setOpenId(null); }} style={{ ...btn("#7affcb"), padding: "4px 10px", fontSize: 11 }}>Save</button>
                          <button onClick={() => setOpenId(null)} style={{ ...btn("#3a3530"), color: "#e8e0d2", padding: "4px 10px", fontSize: 11 }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ flex: 1, fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.5, color: "#cfc7b8", fontStyle: l.user_note ? "normal" : "italic", opacity: l.user_note ? 1 : 0.5 }}>
                          {l.user_note ?? "no reaction yet"}
                        </span>
                        <button onClick={() => { setOpenId(l.id); setNoteDraft(l.user_note ?? ""); }} style={{ ...btn("transparent"), color: "#bfd4ee", border: "1px solid #2a2620", padding: "2px 10px", fontSize: 10 }}>Edit</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => patch(l.id, { pin: !l.pinned })} style={{ ...btn("transparent"), color: "#f4c9d8", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>
                    {l.pinned ? "Unpin" : "Pin"}
                  </button>
                  {isPendingForward && (
                    <button onClick={() => patch(l.id, { cancel: true })} style={{ ...btn("transparent"), color: "#fbb86d", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Cancel delivery</button>
                  )}
                  {l.cancelled_at != null && (
                    <button onClick={() => patch(l.id, { uncancel: true })} style={{ ...btn("transparent"), color: "#7affcb", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Reactivate</button>
                  )}
                  {l.archived_at != null ? (
                    <button onClick={() => patch(l.id, { restore: true })} style={{ ...btn("transparent"), color: "#7affcb", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Restore</button>
                  ) : (
                    <button onClick={() => patch(l.id, { archive: true })} style={{ ...btn("transparent"), color: "#9aa28e", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Archive</button>
                  )}
                  <span style={{ flex: 1 }} />
                  <button onClick={() => remove(l.id)} style={{ ...btn("transparent"), color: "#ff6b6b", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "#1a1612",
    border: "none",
    padding: "6px 14px",
    borderRadius: 4,
    fontFamily: "inherit",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  };
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: 12,
    border: "1px solid #2a2620",
    background: active ? "#bfd4ee" : "transparent",
    color: active ? "#1a1612" : "#e8e0d2",
    fontFamily: "inherit",
    fontSize: 11,
    cursor: "pointer",
  };
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: 1, opacity: 0.6, marginTop: 14, marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", background: "#0e0c0a", border: "1px solid #2a2620", color: "#e8e0d2", padding: "8px 10px", borderRadius: 4, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, marginBottom: 6, boxSizing: "border-box" };
