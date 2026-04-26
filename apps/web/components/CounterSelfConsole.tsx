"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type FalsifiablePrediction = { prediction: string; by_when: string };
type ChamberSession = {
  id: string;
  target_kind: "decision" | "identity_claim" | "theme" | "policy" | "reflection" | "generic";
  target_id: string | null;
  target_snapshot: string;
  challenger_voice: "smart_cynic" | "concerned_mentor" | "failure_timeline_self" | "external_skeptic" | "peer_been_there";
  argument_body: string;
  strongest_counterpoint: string | null;
  falsifiable_predictions: FalsifiablePrediction[];
  user_response: "engaged" | "deferred" | "updated_position" | "dismissed" | null;
  user_response_body: string | null;
  new_position_text: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Status = "open" | "engaged" | "deferred" | "updated_position" | "dismissed" | "archived" | "all";

const VOICE_LABEL: Record<ChamberSession["challenger_voice"], string> = {
  smart_cynic: "the smart cynic",
  concerned_mentor: "the concerned mentor",
  failure_timeline_self: "your failure-timeline self",
  external_skeptic: "the external skeptic",
  peer_been_there: "the peer who has been there",
};

const VOICE_TINT: Record<ChamberSession["challenger_voice"], string> = {
  smart_cynic: "#fbb86d",
  concerned_mentor: "#bfd4ee",
  failure_timeline_self: "#f4c9d8",
  external_skeptic: "#e8e0d2",
  peer_been_there: "#7affcb",
};

const KIND_LABEL: Record<ChamberSession["target_kind"], string> = {
  decision: "decision",
  identity_claim: "identity claim",
  theme: "theme",
  policy: "policy",
  reflection: "reflection",
  generic: "position",
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

export function CounterSelfConsole() {
  const [rows, setRows] = useState<ChamberSession[]>([]);
  const [status, setStatus] = useState<Status>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composePosition, setComposePosition] = useState("");
  const [composeVoice, setComposeVoice] = useState<ChamberSession["challenger_voice"]>("smart_cynic");
  const [generating, setGenerating] = useState(false);

  const [responseOpenId, setResponseOpenId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");
  const [responseMode, setResponseMode] = useState<"engaged" | "updated_position">("engaged");
  const [newPositionDraft, setNewPositionDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/counter-self?status=${status}&limit=100`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { counter_self_chambers: ChamberSession[] };
      setRows(j.counter_self_chambers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    if (composePosition.trim().length < 12) {
      setError("Position must be at least 12 characters.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/counter-self`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_kind: "generic",
          target_snapshot: composePosition.trim(),
          challenger_voice: composeVoice,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setComposeOpen(false);
      setComposePosition("");
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
      const r = await fetch(`/api/counter-self/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
    if (!confirm("Delete this chamber session permanently?")) return;
    setError(null);
    try {
      const r = await fetch(`/api/counter-self/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submitResponse = async (id: string) => {
    if (responseMode === "engaged") {
      if (responseDraft.trim().length < 4) { setError("Engagement requires a response (min 4 chars)."); return; }
      await patch(id, { response: "engaged", user_response_body: responseDraft.trim() });
    } else {
      if (newPositionDraft.trim().length < 8) { setError("New position required (min 8 chars)."); return; }
      await patch(id, { response: "updated_position", new_position_text: newPositionDraft.trim(), user_response_body: responseDraft.trim() || undefined });
    }
    setResponseOpenId(null);
    setResponseDraft("");
    setNewPositionDraft("");
    setResponseMode("engaged");
  };

  const counts = useMemo(() => ({
    open: rows.filter((r) => r.user_response == null && r.archived_at == null).length,
    engaged: rows.filter((r) => r.user_response === "engaged").length,
    deferred: rows.filter((r) => r.user_response === "deferred").length,
    updated_position: rows.filter((r) => r.user_response === "updated_position").length,
    dismissed: rows.filter((r) => r.user_response === "dismissed").length,
    archived: rows.filter((r) => r.archived_at != null).length,
  }), [rows]);

  const STATUS_TABS: Array<{ id: Status; label: string; count?: number }> = [
    { id: "open", label: "Open", count: counts.open },
    { id: "engaged", label: "Engaged", count: counts.engaged },
    { id: "updated_position", label: "Position updated", count: counts.updated_position },
    { id: "deferred", label: "Deferred", count: counts.deferred },
    { id: "dismissed", label: "Dismissed", count: counts.dismissed },
    { id: "archived", label: "Archived", count: counts.archived },
    { id: "all", label: "All" },
  ];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", color: "#e8e0d2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <button
          onClick={() => { setComposeOpen(true); }}
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
          ENTER THE CHAMBER
        </button>
        <span style={{ color: "#7a7268", fontSize: 12 }}>
          bring a position you hold, pick a challenger voice, get the strongest case against it
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
          no chamber sessions yet. enter the chamber and bring a position to be tested.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {rows.map((c) => {
          const isOpen = c.user_response == null && c.archived_at == null;
          const tint = VOICE_TINT[c.challenger_voice];
          return (
            <div
              key={c.id}
              style={{
                background: "#1a1612",
                borderLeft: `3px solid ${tint}`,
                padding: "16px 20px",
                borderRadius: "0 4px 4px 0",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: tint, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>{VOICE_LABEL[c.challenger_voice]}</span>
                  <span style={{ color: "#7a7268", fontSize: 11 }}>vs your {KIND_LABEL[c.target_kind]} · {relTime(c.created_at)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {c.user_response && (
                    <span style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 3,
                      letterSpacing: "0.04em",
                      background: c.user_response === "engaged" ? "#1f3a2c" : c.user_response === "updated_position" ? "#1a2e3a" : c.user_response === "deferred" ? "#3a2c1a" : "#2a2620",
                      color: c.user_response === "engaged" ? "#7affcb" : c.user_response === "updated_position" ? "#bfd4ee" : c.user_response === "deferred" ? "#fbb86d" : "#7a7268",
                      textTransform: "uppercase",
                    }}>
                      {c.user_response.replace("_", " ")}
                    </span>
                  )}
                  {c.pinned && <span style={{ color: "#fbb86d", fontSize: 13 }}>pinned</span>}
                </div>
              </div>

              <div style={{ background: "#0f0d0a", borderLeft: "2px solid #2a2620", padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#9aa28e", fontStyle: "italic", lineHeight: 1.5, borderRadius: "0 3px 3px 0" }}>
                <span style={{ color: "#5a5248", fontSize: 9, letterSpacing: "0.08em", display: "block", marginBottom: 3 }}>YOUR POSITION</span>
                {c.target_snapshot}
              </div>

              <div style={{ fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1.7, color: "#e8e0d2", marginBottom: 14, whiteSpace: "pre-wrap" }}>
                {c.argument_body}
              </div>

              {c.strongest_counterpoint && (
                <div style={{ borderTop: "1px solid #2a2620", paddingTop: 12, marginBottom: 14 }}>
                  <div style={{ color: tint, fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>THE LINE TO SIT WITH</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1.6, color: "#e8e0d2", fontStyle: "italic" }}>
                    &ldquo;{c.strongest_counterpoint}&rdquo;
                  </div>
                </div>
              )}

              {c.falsifiable_predictions && c.falsifiable_predictions.length > 0 && (
                <div style={{ borderTop: "1px solid #2a2620", paddingTop: 12, marginBottom: 14 }}>
                  <div style={{ color: "#7a7268", fontSize: 10, letterSpacing: "0.08em", marginBottom: 8 }}>TRIP-WIRES &mdash; if any of these fire, revisit the position</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {c.falsifiable_predictions.map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12, lineHeight: 1.5 }}>
                        <span style={{ color: "#5a5248", flexShrink: 0 }}>&middot;</span>
                        <div>
                          <span style={{ color: "#e8e0d2" }}>{p.prediction}</span>
                          <span style={{ color: "#7a7268", marginLeft: 8 }}>&mdash; {p.by_when}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {c.user_response_body && (
                <div style={{ marginBottom: 14, paddingTop: 12, borderTop: "1px solid #2a2620" }}>
                  <div style={{ color: "#7a7268", fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>YOUR ENGAGEMENT</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 14, lineHeight: 1.6, color: "#e8e0d2", whiteSpace: "pre-wrap" }}>
                    {c.user_response_body}
                  </div>
                </div>
              )}

              {c.new_position_text && (
                <div style={{ marginBottom: 14, padding: "10px 14px", background: "#1a2030", borderLeft: "2px solid #bfd4ee", borderRadius: "0 3px 3px 0" }}>
                  <div style={{ color: "#bfd4ee", fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>YOUR UPDATED POSITION</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 14, lineHeight: 1.6, color: "#e8e0d2" }}>
                    {c.new_position_text}
                  </div>
                </div>
              )}

              {c.latency_ms != null && (
                <div style={{ color: "#5a5248", fontSize: 10, marginBottom: 12, fontStyle: "italic" }}>
                  generated in {(c.latency_ms / 1000).toFixed(1)}s{c.model ? ` · ${c.model.split("-").slice(0, 2).join("-")}` : ""}
                </div>
              )}

              {responseOpenId === c.id ? (
                <div style={{ marginBottom: 12, padding: "12px 14px", background: "#0f0d0a", borderRadius: 3 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <button
                      onClick={() => setResponseMode("engaged")}
                      style={{ background: responseMode === "engaged" ? "#2a2620" : "transparent", color: responseMode === "engaged" ? "#7affcb" : "#7a7268", border: `1px solid ${responseMode === "engaged" ? "#7affcb" : "#2a2620"}`, padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      engage (rebut / integrate)
                    </button>
                    <button
                      onClick={() => setResponseMode("updated_position")}
                      style={{ background: responseMode === "updated_position" ? "#2a2620" : "transparent", color: responseMode === "updated_position" ? "#bfd4ee" : "#7a7268", border: `1px solid ${responseMode === "updated_position" ? "#bfd4ee" : "#2a2620"}`, padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      update position (the case landed)
                    </button>
                  </div>
                  {responseMode === "updated_position" && (
                    <>
                      <label style={{ color: "#bfd4ee", fontSize: 10, letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>NEW POSITION</label>
                      <textarea
                        value={newPositionDraft}
                        onChange={(e) => setNewPositionDraft(e.target.value)}
                        placeholder="the position you now hold, in your own words"
                        rows={2}
                        style={{ width: "100%", background: "#1a1612", color: "#e8e0d2", border: "1px solid #2a2620", padding: 8, fontFamily: "inherit", fontSize: 12, borderRadius: 3, resize: "vertical", marginBottom: 10 }}
                      />
                    </>
                  )}
                  <label style={{ color: "#9aa28e", fontSize: 10, letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>{responseMode === "engaged" ? "YOUR REBUTTAL OR INTEGRATION" : "OPTIONAL NOTE ON THE UPDATE"}</label>
                  <textarea
                    value={responseDraft}
                    onChange={(e) => setResponseDraft(e.target.value)}
                    placeholder={responseMode === "engaged" ? "what's right and what's wrong about the case the challenger made" : "what changed, and why"}
                    rows={4}
                    style={{ width: "100%", background: "#1a1612", color: "#e8e0d2", border: "1px solid #2a2620", padding: 8, fontFamily: "inherit", fontSize: 12, borderRadius: 3, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => submitResponse(c.id)}
                      style={{ background: "#fbb86d", color: "#1a1612", border: "none", padding: "5px 14px", fontSize: 11, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 3 }}
                    >
                      save response
                    </button>
                    <button
                      onClick={() => { setResponseOpenId(null); setResponseDraft(""); setNewPositionDraft(""); }}
                      style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {isOpen && responseOpenId !== c.id && (
                  <>
                    <button
                      onClick={() => { setResponseOpenId(c.id); setResponseMode("engaged"); setResponseDraft(""); setNewPositionDraft(""); }}
                      style={{ background: "transparent", color: "#7affcb", border: "1px solid #7affcb", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      respond
                    </button>
                    <button
                      onClick={() => patch(c.id, { response: "deferred" })}
                      style={{ background: "transparent", color: "#fbb86d", border: "1px solid #fbb86d", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      defer
                    </button>
                    <button
                      onClick={() => patch(c.id, { response: "dismissed" })}
                      style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                    >
                      dismiss
                    </button>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => patch(c.id, { pin: !c.pinned })}
                  style={{ background: "transparent", color: c.pinned ? "#fbb86d" : "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                >
                  {c.pinned ? "unpin" : "pin"}
                </button>
                <button
                  onClick={() => patch(c.id, c.archived_at ? { restore: true } : { archive: true })}
                  style={{ background: "transparent", color: "#7a7268", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 3 }}
                >
                  {c.archived_at ? "restore" : "archive"}
                </button>
                <button
                  onClick={() => remove(c.id)}
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
          <div style={{ background: "#1a1612", border: "1px solid #2a2620", borderRadius: 6, padding: 24, width: 540, maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ color: "#e8e0d2", fontSize: 14, marginBottom: 14, letterSpacing: "0.02em" }}>ENTER THE CHAMBER</div>
            <div style={{ color: "#7a7268", fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
              write the position you hold (a decision, a stance, an identity claim, anything you&apos;d defend right now). pick a challenger voice. the chamber will write the strongest case against it.
            </div>

            <label style={{ color: "#9aa28e", fontSize: 11, display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>YOUR POSITION</label>
            <textarea
              value={composePosition}
              onChange={(e) => setComposePosition(e.target.value)}
              placeholder="e.g. I should keep grinding on the agency for another 6 months because the relationships I'm building will compound."
              rows={4}
              style={{ width: "100%", background: "#0e0c0a", color: "#e8e0d2", border: "1px solid #2a2620", padding: 8, fontFamily: "inherit", fontSize: 13, borderRadius: 3, resize: "vertical", marginBottom: 16 }}
            />

            <label style={{ color: "#9aa28e", fontSize: 11, display: "block", marginBottom: 8, letterSpacing: "0.04em" }}>CHALLENGER VOICE</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
              {(Object.keys(VOICE_LABEL) as Array<ChamberSession["challenger_voice"]>).map((v) => (
                <button
                  key={v}
                  onClick={() => setComposeVoice(v)}
                  style={{
                    textAlign: "left",
                    background: composeVoice === v ? "#2a2620" : "transparent",
                    color: composeVoice === v ? "#e8e0d2" : "#9aa28e",
                    border: `1px solid ${composeVoice === v ? VOICE_TINT[v] : "#2a2620"}`,
                    padding: "8px 12px",
                    fontFamily: "inherit",
                    fontSize: 12,
                    cursor: "pointer",
                    borderRadius: 3,
                  }}
                >
                  <div style={{ color: VOICE_TINT[v], fontSize: 11, letterSpacing: "0.04em", marginBottom: 2, textTransform: "uppercase" }}>{VOICE_LABEL[v]}</div>
                  <div style={{ fontSize: 11, color: "#7a7268", lineHeight: 1.4 }}>
                    {v === "smart_cynic" && "assumes the worst about motives. names ego, self-deception, status games. sharp without sneering."}
                    {v === "concerned_mentor" && "believes in you, which is exactly why they can't let this stand. names blind spots, kindly."}
                    {v === "failure_timeline_self" && "the version of you who pursued this and watched it fall apart. first-person from the wreckage."}
                    {v === "external_skeptic" && "no skin in the game. clinical. finds the holes a stranger would find."}
                    {v === "peer_been_there" && "six steps further down the road you're on. trades, doesn't lecture."}
                  </div>
                </button>
              ))}
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
                disabled={generating || composePosition.trim().length < 12}
                style={{ background: "#fbb86d", color: "#1a1612", border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: generating ? "default" : "pointer", borderRadius: 3, letterSpacing: "0.02em", opacity: generating || composePosition.trim().length < 12 ? 0.6 : 1 }}
              >
                {generating ? "BUILDING THE CASE..." : "BUILD THE CASE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
