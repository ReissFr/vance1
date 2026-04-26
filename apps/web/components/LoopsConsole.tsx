"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type IntentionRow = { text: string; completed_at: string | null; carried_from: string | null };
type CommitmentRow = {
  id: string;
  direction: "inbound" | "outbound";
  other_party: string | null;
  commitment_text: string;
  deadline: string | null;
  status: string;
};
type QuestionRow = { id: string; text: string; kind: string; priority: number; created_at: string };
type IdeaRow = { id: string; text: string; kind: string; heat: number; created_at: string };
type GoalRow = { id: string; title: string; target_date: string; progress_pct: number };
type DecisionRow = { id: string; title: string; review_at: string | null; created_at: string };
type LessonRow = { id: string; text: string; kind: string; created_at: string };

type Loops = {
  intention: IntentionRow | null;
  commitments: CommitmentRow[];
  questions: QuestionRow[];
  hot_ideas: IdeaRow[];
  goals_due: GoalRow[];
  stale_decisions: DecisionRow[];
  recent_lessons: LessonRow[];
};

const SECTION: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: 12,
  padding: "16px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const HEADER: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  letterSpacing: "1.6px",
  color: "var(--ink-3)",
  textTransform: "uppercase",
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
};

const ITEM_TEXT: React.CSSProperties = {
  fontFamily: "var(--serif)",
  fontStyle: "italic",
  fontSize: 15,
  lineHeight: 1.45,
  color: "var(--ink)",
};

const META: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  color: "var(--ink-3)",
  letterSpacing: "0.4px",
};

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  return Math.round((target - Date.now()) / 86400000);
}

function dueLabel(dateStr: string | null): string {
  if (!dateStr) return "no deadline";
  const d = daysUntil(dateStr);
  if (d < 0) return `overdue ${-d}d`;
  if (d === 0) return "due today";
  if (d === 1) return "tomorrow";
  return `in ${d}d`;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function LoopsConsole() {
  const [data, setData] = useState<Loops | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/loops");
    if (res.ok) {
      const json = (await res.json()) as Loops;
      setData(json);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div
        style={{
          padding: "60px 20px",
          textAlign: "center",
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 17,
          color: "var(--ink-3)",
        }}
      >
        Gathering open loops…
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={{
          padding: "60px 20px",
          textAlign: "center",
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 17,
          color: "var(--ink-3)",
        }}
      >
        Could not load loops.
      </div>
    );
  }

  const totalOpen =
    (data.intention && !data.intention.completed_at ? 1 : 0) +
    data.commitments.length +
    data.questions.length +
    data.hot_ideas.length +
    data.goals_due.length +
    data.stale_decisions.length;

  const allClear =
    totalOpen === 0 &&
    data.recent_lessons.length === 0;

  if (allClear) {
    return (
      <div
        style={{
          padding: "80px 20px",
          textAlign: "center",
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 19,
          color: "var(--ink-2)",
          lineHeight: 1.6,
        }}
      >
        Inbox zero across the board.
        <div style={{ marginTop: 8, fontSize: 14, color: "var(--ink-3)" }}>
          No today-intention, no due commitments, no hot ideas, no open questions, no goals at risk.
          Pick something audacious to fill the silence.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px 80px" }}>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 16,
          color: "var(--ink-2)",
          padding: "0 4px",
          lineHeight: 1.5,
        }}
      >
        {totalOpen === 0
          ? "Nothing demanding right now — just lessons worth re-reading."
          : `${totalOpen} open ${totalOpen === 1 ? "thread" : "threads"} across the journals. Skim, decide, close, or carry.`}
      </div>

      {data.intention && !data.intention.completed_at && (
        <div style={SECTION}>
          <div style={HEADER}>
            <span>Today's intention</span>
            <Link href="/intentions" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          <div style={ITEM_TEXT}>
            {data.intention.text}
            {data.intention.carried_from && (
              <span style={{ ...META, marginLeft: 8 }}>(carried)</span>
            )}
          </div>
        </div>
      )}

      {data.commitments.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>
            <span>Commitments due ≤ 7 days · {data.commitments.length}</span>
            <Link href="/commitments" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          {data.commitments.map((c) => {
            const overdue = c.deadline && daysUntil(c.deadline) < 0;
            return (
              <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={ITEM_TEXT}>
                  {c.direction === "outbound"
                    ? `I owe ${c.other_party || "someone"}: ${c.commitment_text}`
                    : `${c.other_party || "Someone"} owes me: ${c.commitment_text}`}
                </div>
                <div style={{ ...META, color: overdue ? "#f4a3a3" : "var(--ink-3)" }}>
                  {dueLabel(c.deadline)} · {c.direction}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.questions.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>
            <span>Open questions · {data.questions.length}</span>
            <Link href="/questions" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          {data.questions.map((q) => (
            <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={ITEM_TEXT}>{q.text}</div>
              <div style={META}>
                P{q.priority} · {q.kind} · {relTime(q.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.hot_ideas.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>
            <span>Hot ideas · {data.hot_ideas.length}</span>
            <Link href="/ideas" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          {data.hot_ideas.map((i) => (
            <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={ITEM_TEXT}>{i.text}</div>
              <div style={META}>
                heat {i.heat}/5 · {i.kind} · {relTime(i.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.goals_due.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>
            <span>Goals due ≤ 14 days · {data.goals_due.length}</span>
            <Link href="/goals" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          {data.goals_due.map((g) => {
            const d = daysUntil(g.target_date);
            const slipping = d < 7 && g.progress_pct < 60;
            return (
              <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={ITEM_TEXT}>{g.title}</div>
                <div style={{ ...META, color: slipping ? "#f4a3a3" : "var(--ink-3)" }}>
                  {g.progress_pct}% · {dueLabel(g.target_date)}
                  {slipping ? " · slipping" : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.stale_decisions.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>
            <span>Decisions due for review · {data.stale_decisions.length}</span>
            <Link href="/decisions" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          {data.stale_decisions.map((d) => (
            <div key={d.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={ITEM_TEXT}>{d.title}</div>
              <div style={META}>
                review was {d.review_at} · logged {relTime(d.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.recent_lessons.length > 0 && (
        <div style={{ ...SECTION, borderLeft: "3px solid #7affcb" }}>
          <div style={HEADER}>
            <span>Recent lessons · don't relearn</span>
            <Link href="/reflections" style={{ ...META, textDecoration: "none" }}>
              ↗ open
            </Link>
          </div>
          {data.recent_lessons.map((l) => (
            <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={ITEM_TEXT}>{l.text}</div>
              <div style={META}>
                {l.kind} · {relTime(l.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
