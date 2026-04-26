"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Decision = {
  id: string;
  title: string;
  context: string | null;
  choice: string;
  alternatives: string | null;
  expected_outcome: string | null;
  review_at: string | null;
  reviewed_at: string | null;
  outcome_note: string | null;
  outcome_label: "right_call" | "wrong_call" | "mixed" | "unclear" | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
};

type Filter = "open" | "due" | "reviewed" | "all";

const LABEL_COLOR: Record<NonNullable<Decision["outcome_label"]>, string> = {
  right_call: "#7affcb",
  wrong_call: "#ff6b6b",
  mixed: "#f4c9d8",
  unclear: "#bfd4ee",
};

const LABEL_TEXT: Record<NonNullable<Decision["outcome_label"]>, string> = {
  right_call: "Right call",
  wrong_call: "Wrong call",
  mixed: "Mixed",
  unclear: "Unclear",
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function dueLabel(reviewAt: string | null): { text: string; tone: "due" | "soon" | "later" | "none" } {
  if (!reviewAt) return { text: "no review date", tone: "none" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(reviewAt + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "due" };
  if (days === 0) return { text: "review today", tone: "due" };
  if (days <= 3) return { text: `review in ${days}d`, tone: "soon" };
  return { text: `review in ${days}d`, tone: "later" };
}

export function DecisionsConsole() {
  const [rows, setRows] = useState<Decision[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [filter, setFilter] = useState<Filter>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState("");
  const [context, setContext] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [expected, setExpected] = useState("");
  const [reviewInDays, setReviewInDays] = useState<number>(14);
  const [saving, setSaving] = useState(false);

  const [reviewing, setReviewing] = useState<Decision | null>(null);
  const [outcomeLabel, setOutcomeLabel] = useState<Decision["outcome_label"]>("right_call");
  const [outcomeNote, setOutcomeNote] = useState("");

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/decisions?filter=${f}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { rows: Decision[]; due_count: number };
      setRows(j.rows ?? []);
      setDueCount(j.due_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const resetForm = useCallback(() => {
    setTitle("");
    setChoice("");
    setContext("");
    setAlternatives("");
    setExpected("");
    setReviewInDays(14);
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const t = title.trim();
      const c = choice.trim();
      if (!t || !c) return;
      setSaving(true);
      setError(null);
      try {
        const r = await fetch("/api/decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: t,
            choice: c,
            context: context.trim() || null,
            alternatives: alternatives.trim() || null,
            expected_outcome: expected.trim() || null,
            review_in_days: reviewInDays > 0 ? reviewInDays : null,
          }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        resetForm();
        setShowForm(false);
        await load(filter);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [title, choice, context, alternatives, expected, reviewInDays, filter, load, resetForm],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this decision?")) return;
      try {
        await fetch(`/api/decisions/${id}`, { method: "DELETE" });
      } finally {
        void load(filter);
      }
    },
    [filter, load],
  );

  const openReview = useCallback((d: Decision) => {
    setReviewing(d);
    setOutcomeLabel(d.outcome_label ?? "right_call");
    setOutcomeNote(d.outcome_note ?? "");
  }, []);

  const submitReview = useCallback(async () => {
    if (!reviewing) return;
    try {
      const r = await fetch(`/api/decisions/${reviewing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          outcome_label: outcomeLabel,
          outcome_note: outcomeNote.trim() || null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setReviewing(null);
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reviewing, outcomeLabel, outcomeNote, filter, load]);

  const reopen = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/decisions/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewed: false }),
        });
      } finally {
        void load(filter);
      }
    },
    [filter, load],
  );

  const filterPills = useMemo(
    () => [
      { id: "open" as const, label: "Open" },
      { id: "due" as const, label: "Due", badge: dueCount },
      { id: "reviewed" as const, label: "Reviewed" },
      { id: "all" as const, label: "All" },
    ],
    [dueCount],
  );

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 820,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {filterPills.map((p) => {
          const active = filter === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                background: active ? "var(--ink)" : "transparent",
                color: active ? "#000" : "var(--ink-2)",
                border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {p.label}
              {"badge" in p && p.badge != null && p.badge > 0 && (
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 8,
                    background: active ? "rgba(0,0,0,0.15)" : "#ff6b6b",
                    color: active ? "#000" : "#fff",
                    fontSize: 9.5,
                  }}
                >
                  {p.badge}
                </span>
              )}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            padding: "8px 18px",
            borderRadius: 10,
            background: showForm ? "transparent" : "var(--ink)",
            color: showForm ? "var(--ink-2)" : "#000",
            border: showForm ? "1px solid var(--rule)" : "none",
            fontFamily: "var(--sans)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : "Log a decision"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          style={{
            padding: "22px 24px",
            borderRadius: 16,
            background: "var(--panel)",
            border: "1px solid var(--rule)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <Field label="Decision (short title)" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={200}
              placeholder="e.g. Drop Tavus, build avatar in-browser"
              style={inputStyle}
            />
          </Field>
          <Field label="What I chose" required>
            <textarea
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="One or two sentences on the actual decision."
              style={textareaStyle}
            />
          </Field>
          <Field label="Why / context">
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="The situation you were in, the constraints."
              style={textareaStyle}
            />
          </Field>
          <Field label="Alternatives I rejected">
            <textarea
              value={alternatives}
              onChange={(e) => setAlternatives(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="What else was on the table, and why you didn't pick it."
              style={textareaStyle}
            />
          </Field>
          <Field label="What success looks like">
            <textarea
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="What you expect to be true if this was the right call."
              style={textareaStyle}
            />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              Review in
            </span>
            {[7, 14, 30, 60, 90].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setReviewInDays(n)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 16,
                  background: reviewInDays === n ? "var(--ink)" : "transparent",
                  color: reviewInDays === n ? "#000" : "var(--ink-2)",
                  border: `1px solid ${reviewInDays === n ? "var(--ink)" : "var(--rule)"}`,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {n}d
              </button>
            ))}
            <button
              type="button"
              onClick={() => setReviewInDays(0)}
              style={{
                padding: "5px 11px",
                borderRadius: 16,
                background: reviewInDays === 0 ? "var(--ink)" : "transparent",
                color: reviewInDays === 0 ? "#000" : "var(--ink-2)",
                border: `1px solid ${reviewInDays === 0 ? "var(--ink)" : "var(--rule)"}`,
                fontFamily: "var(--mono)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              never
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="submit"
              disabled={saving || !title.trim() || !choice.trim()}
              style={{
                padding: "10px 22px",
                borderRadius: 10,
                background: saving ? "var(--rule)" : "var(--ink)",
                color: saving ? "var(--ink-3)" : "#000",
                border: "none",
                fontFamily: "var(--sans)",
                fontSize: 13,
                fontWeight: 500,
                cursor: saving ? "default" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Log decision"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map((d) => {
          const due = dueLabel(d.review_at);
          const dueColor =
            due.tone === "due" ? "#ff6b6b" : due.tone === "soon" ? "#f4c9d8" : "var(--ink-3)";
          return (
            <div
              key={d.id}
              style={{
                padding: "20px 22px",
                borderRadius: 14,
                background: "var(--panel)",
                border: "1px solid var(--rule)",
                opacity: d.reviewed_at ? 0.85 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 19,
                      color: "var(--ink)",
                      lineHeight: 1.35,
                      marginBottom: 8,
                    }}
                  >
                    {d.title}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        color: "var(--ink-3)",
                        letterSpacing: 0.6,
                        textTransform: "uppercase",
                      }}
                    >
                      logged {relTime(d.created_at)}
                    </span>
                    {!d.reviewed_at && (
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          color: dueColor,
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                        }}
                      >
                        {due.text}
                      </span>
                    )}
                    {d.reviewed_at && d.outcome_label && (
                      <span
                        style={{
                          padding: "2px 9px",
                          borderRadius: 10,
                          background: LABEL_COLOR[d.outcome_label],
                          color: "#000",
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                        }}
                      >
                        {LABEL_TEXT[d.outcome_label]}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {d.reviewed_at ? (
                    <button onClick={() => reopen(d.id)} style={smallBtn}>
                      Reopen
                    </button>
                  ) : (
                    <button onClick={() => openReview(d)} style={smallBtn}>
                      Review
                    </button>
                  )}
                  <button onClick={() => remove(d.id)} style={smallBtn}>
                    ×
                  </button>
                </div>
              </div>

              <Block label="Choice">{d.choice}</Block>
              {d.context && <Block label="Context">{d.context}</Block>}
              {d.alternatives && <Block label="Alternatives rejected">{d.alternatives}</Block>}
              {d.expected_outcome && <Block label="What success looks like">{d.expected_outcome}</Block>}
              {d.reviewed_at && d.outcome_note && <Block label="Outcome">{d.outcome_note}</Block>}
            </div>
          );
        })}

        {!loading && rows.length === 0 && (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 17,
              color: "var(--ink-3)",
              border: "1px dashed var(--rule)",
              borderRadius: 14,
            }}
          >
            {filter === "due"
              ? "Nothing to review right now."
              : filter === "reviewed"
                ? "No reviews logged yet."
                : "Capture a decision and what you expected to happen — your future self will thank you."}
          </div>
        )}
      </div>

      {reviewing && (
        <div
          onClick={() => setReviewing(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(540px, 100%)",
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: 16,
              padding: "26px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                Reviewing
              </div>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontStyle: "italic",
                  fontSize: 20,
                  color: "var(--ink)",
                }}
              >
                {reviewing.title}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                How did it land?
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(Object.keys(LABEL_TEXT) as Array<keyof typeof LABEL_TEXT>).map((k) => {
                  const active = outcomeLabel === k;
                  return (
                    <button
                      key={k}
                      onClick={() => setOutcomeLabel(k)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        background: active ? LABEL_COLOR[k] : "transparent",
                        color: active ? "#000" : "var(--ink-2)",
                        border: `1px solid ${active ? LABEL_COLOR[k] : "var(--rule)"}`,
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        letterSpacing: 0.6,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      {LABEL_TEXT[k]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 8,
                }}
              >
                What you learned
              </div>
              <textarea
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Optional. What actually happened? What would you do differently?"
                style={textareaStyle}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setReviewing(null)} style={ghostBtn}>
                Cancel
              </button>
              <button
                onClick={() => void submitReview()}
                style={{
                  padding: "10px 22px",
                  borderRadius: 10,
                  background: "var(--ink)",
                  color: "#000",
                  border: "none",
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Save review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {label}
        {required && <span style={{ color: "#ff6b6b", marginLeft: 4 }}>·</span>}
      </span>
      {children}
    </label>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 9.5,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          color: "var(--ink)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  background: "var(--bg)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontFamily: "var(--sans)",
  fontSize: 14,
  lineHeight: 1.5,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--serif)",
  fontStyle: "italic",
  fontSize: 15,
  resize: "vertical",
  minHeight: 60,
};

const smallBtn: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  background: "transparent",
  color: "var(--ink-3)",
  border: "1px solid var(--rule)",
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  background: "transparent",
  color: "var(--ink-2)",
  border: "1px solid var(--rule)",
  fontFamily: "var(--sans)",
  fontSize: 13,
  cursor: "pointer",
};
