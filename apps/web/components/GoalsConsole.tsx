"use client";

import { useCallback, useEffect, useState } from "react";

type Milestone = { text: string; done_at: string | null };
type Goal = {
  id: string;
  title: string;
  why: string | null;
  kind: "quarterly" | "monthly" | "yearly" | "custom";
  target_date: string | null;
  status: "active" | "done" | "dropped";
  completed_at: string | null;
  progress_pct: number;
  milestones: Milestone[];
  tags: string[] | null;
  created_at: string;
  updated_at: string;
};

type StatusFilter = "active" | "done" | "dropped" | "all";

const KIND_LABEL: Record<Goal["kind"], string> = {
  quarterly: "Quarterly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
};

function dueLabel(date: string | null): { text: string; tone: "overdue" | "soon" | "later" | "none" } {
  if (!date) return { text: "no date", tone: "none" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "overdue" };
  if (days === 0) return { text: "today", tone: "soon" };
  if (days <= 14) return { text: `in ${days}d`, tone: "soon" };
  if (days <= 60) return { text: `in ${Math.round(days / 7)}w`, tone: "later" };
  return { text: `in ${Math.round(days / 30)}mo`, tone: "later" };
}

export function GoalsConsole() {
  const [rows, setRows] = useState<Goal[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftWhy, setDraftWhy] = useState("");
  const [draftKind, setDraftKind] = useState<Goal["kind"]>("quarterly");
  const [draftTarget, setDraftTarget] = useState("");
  const [draftMilestones, setDraftMilestones] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (s: StatusFilter) => {
      setLoading(true);
      try {
        const r = await fetch(`/api/goals?status=${s}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { rows: Goal[] };
        setRows(j.rows ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const t = draftTitle.trim();
      if (!t) return;
      setSaving(true);
      setError(null);
      try {
        const milestones = draftMilestones
          .split("\n")
          .map((m) => m.trim())
          .filter(Boolean)
          .map((m) => ({ text: m, done_at: null }));

        const r = await fetch("/api/goals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: t,
            why: draftWhy.trim() || null,
            kind: draftKind,
            target_date: draftTarget || null,
            milestones,
          }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        setDraftTitle("");
        setDraftWhy("");
        setDraftTarget("");
        setDraftMilestones("");
        setShowForm(false);
        await load(filter);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [draftTitle, draftWhy, draftKind, draftTarget, draftMilestones, filter, load],
  );

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      try {
        await fetch(`/api/goals/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } finally {
        void load(filter);
      }
    },
    [filter, load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this goal?")) return;
      try {
        await fetch(`/api/goals/${id}`, { method: "DELETE" });
      } finally {
        void load(filter);
      }
    },
    [filter, load],
  );

  const toggleMilestone = useCallback(
    async (g: Goal, idx: number) => {
      const next = g.milestones.map((m, i) =>
        i === idx ? { ...m, done_at: m.done_at ? null : new Date().toISOString() } : m,
      );
      const completedCount = next.filter((m) => m.done_at).length;
      const pct = next.length === 0 ? g.progress_pct : Math.round((completedCount / next.length) * 100);
      await patch(g.id, { milestones: next, progress_pct: pct });
    },
    [patch],
  );

  const addMilestone = useCallback(
    async (g: Goal, text: string) => {
      const t = text.trim();
      if (!t) return;
      const next = [...g.milestones, { text: t, done_at: null }];
      await patch(g.id, { milestones: next });
    },
    [patch],
  );

  const filterPills: Array<{ id: StatusFilter; label: string }> = [
    { id: "active", label: "Active" },
    { id: "done", label: "Done" },
    { id: "dropped", label: "Dropped" },
    { id: "all", label: "All" },
  ];

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 820,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
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
                padding: "5px 12px",
                borderRadius: 16,
                background: active ? "var(--ink)" : "transparent",
                color: active ? "#000" : "var(--ink-2)",
                border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {p.label}
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
          {showForm ? "Cancel" : "Add a goal"}
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
          <Field label="Goal" required>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              autoFocus
              maxLength={200}
              placeholder="e.g. Get 100 paying users for SevenPoint"
              style={inputStyle}
            />
          </Field>
          <Field label="Why this matters">
            <textarea
              value={draftWhy}
              onChange={(e) => setDraftWhy(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="The reason you want this — keeps you honest when it gets hard."
              style={textareaStyle}
            />
          </Field>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {(Object.keys(KIND_LABEL) as Array<Goal["kind"]>).map((k) => {
                const active = draftKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDraftKind(k)}
                    style={{
                      padding: "5px 11px",
                      borderRadius: 16,
                      background: active ? "var(--ink)" : "transparent",
                      color: active ? "#000" : "var(--ink-2)",
                      border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
            <input
              type="date"
              value={draftTarget}
              onChange={(e) => setDraftTarget(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--bg)",
                border: "1px solid var(--rule)",
                color: "var(--ink)",
                fontFamily: "var(--mono)",
                fontSize: 12,
              }}
            />
          </div>
          <Field label="Milestones (one per line)">
            <textarea
              value={draftMilestones}
              onChange={(e) => setDraftMilestones(e.target.value)}
              rows={4}
              placeholder={"First 10 paying users\nLanding page live\nFirst paid ad campaign"}
              style={{ ...textareaStyle, fontFamily: "var(--mono)", fontStyle: "normal" }}
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={saving || !draftTitle.trim()}
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
              {saving ? "Saving…" : "Add goal"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            onPatch={(body) => void patch(g.id, body)}
            onDelete={() => void remove(g.id)}
            onToggleMilestone={(idx) => void toggleMilestone(g, idx)}
            onAddMilestone={(text) => void addMilestone(g, text)}
          />
        ))}

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
            {filter === "active"
              ? "Pick the few things that actually matter this quarter."
              : "Nothing here."}
          </div>
        )}
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  onPatch,
  onDelete,
  onToggleMilestone,
  onAddMilestone,
}: {
  goal: Goal;
  onPatch: (body: Record<string, unknown>) => void;
  onDelete: () => void;
  onToggleMilestone: (idx: number) => void;
  onAddMilestone: (text: string) => void;
}) {
  const [newMs, setNewMs] = useState("");
  const due = dueLabel(goal.target_date);
  const dueColor =
    due.tone === "overdue" ? "#ff6b6b" : due.tone === "soon" ? "#f4c9d8" : "var(--ink-3)";
  const completed = goal.milestones.filter((m) => m.done_at).length;

  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 14,
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        opacity: goal.status === "active" ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 20,
              color: "var(--ink)",
              lineHeight: 1.3,
              textDecorationLine: goal.status === "done" ? "line-through" : "none",
              textDecorationColor: "var(--ink-3)",
            }}
          >
            {goal.title}
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: 6,
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
              {KIND_LABEL[goal.kind]}
            </span>
            {goal.target_date && (
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
            {goal.status !== "active" && (
              <span
                style={{
                  padding: "1px 8px",
                  borderRadius: 8,
                  background: goal.status === "done" ? "#7affcb" : "var(--rule)",
                  color: "#000",
                  fontFamily: "var(--mono)",
                  fontSize: 9.5,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                {goal.status}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {goal.status === "active" && (
            <>
              <button onClick={() => onPatch({ status: "done" })} style={smallBtn}>
                Done
              </button>
              <button onClick={() => onPatch({ status: "dropped" })} style={smallBtn}>
                Drop
              </button>
            </>
          )}
          {goal.status !== "active" && (
            <button onClick={() => onPatch({ status: "active" })} style={smallBtn}>
              Reopen
            </button>
          )}
          <button onClick={onDelete} style={smallBtn}>
            ×
          </button>
        </div>
      </div>

      {goal.why && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--bg)",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--ink-2)",
            lineHeight: 1.5,
            borderLeft: "3px solid var(--rule)",
          }}
        >
          {goal.why}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-3)",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Progress {goal.progress_pct}% {goal.milestones.length > 0 && `(${completed}/${goal.milestones.length})`}
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--rule)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${goal.progress_pct}%`,
              height: "100%",
              background: "#7affcb",
              transition: "width 0.3s",
            }}
          />
        </div>
      </div>

      {goal.milestones.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          {goal.milestones.map((m, i) => (
            <button
              key={`${m.text}-${i}`}
              onClick={() => onToggleMilestone(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--rule)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: m.done_at ? "#7affcb" : "transparent",
                  border: `1px solid ${m.done_at ? "#7affcb" : "var(--rule)"}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#000",
                  fontFamily: "var(--sans)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {m.done_at ? "✓" : ""}
              </span>
              <span
                style={{
                  flex: 1,
                  fontFamily: "var(--sans)",
                  fontSize: 13.5,
                  color: m.done_at ? "var(--ink-3)" : "var(--ink)",
                  textDecorationLine: m.done_at ? "line-through" : "none",
                }}
              >
                {m.text}
              </span>
            </button>
          ))}
        </div>
      )}

      {goal.status === "active" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAddMilestone(newMs);
            setNewMs("");
          }}
          style={{ marginTop: 10, display: "flex", gap: 8 }}
        >
          <input
            type="text"
            value={newMs}
            onChange={(e) => setNewMs(e.target.value)}
            placeholder="+ add milestone"
            maxLength={200}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px dashed var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          />
        </form>
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
