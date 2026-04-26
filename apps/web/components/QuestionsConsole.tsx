"use client";

import { useCallback, useEffect, useState } from "react";

type Question = {
  id: string;
  text: string;
  kind: "strategic" | "customer" | "technical" | "personal" | "other";
  status: "open" | "exploring" | "answered" | "dropped";
  priority: number;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
};

const KIND_COLOR: Record<Question["kind"], string> = {
  strategic: "#bfd4ee",
  customer: "#f4c9d8",
  technical: "#7affcb",
  personal: "#e6d3e8",
  other: "var(--rule)",
};

const KIND_LABEL: Record<Question["kind"], string> = {
  strategic: "Strategic",
  customer: "Customer",
  technical: "Technical",
  personal: "Personal",
  other: "Other",
};

const PRIORITY_LABEL: Record<number, string> = { 1: "P1", 2: "P2", 3: "P3" };

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function QuestionsConsole() {
  const [rows, setRows] = useState<Question[]>([]);
  const [filter, setFilter] = useState<"active" | "open" | "exploring" | "answered" | "all">("active");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Question["kind"]>("strategic");
  const [priority, setPriority] = useState(2);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/questions?status=${filter}`);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Question[] };
    setRows(json.rows ?? []);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, kind, priority }),
      });
      if (res.ok) {
        setText("");
        setKind("strategic");
        setPriority(2);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/questions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/questions/${id}`, { method: "DELETE" });
    await load();
  };

  const filters: { id: typeof filter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "open", label: "Open" },
    { id: "exploring", label: "Exploring" },
    { id: "answered", label: "Answered" },
    { id: "all", label: "All" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "8px 4px 80px" }}>
      <form
        onSubmit={submit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
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
          A question worth holding
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Is the pricing right? Should we hire an engineer? What's the actual moat?"
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            padding: "10px 0",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--rule)",
            outline: "none",
            color: "var(--ink)",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABEL) as Question["kind"][]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--rule)",
                background: kind === k ? KIND_COLOR[k] : "transparent",
                color: kind === k ? "#0d0d10" : "var(--ink-2)",
                cursor: "pointer",
                letterSpacing: "0.4px",
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
          <span style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
            {[1, 2, 3].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  padding: "3px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--rule)",
                  background: priority === p ? "var(--ink)" : "transparent",
                  color: priority === p ? "var(--bg)" : "var(--ink-3)",
                  cursor: "pointer",
                  letterSpacing: "0.4px",
                }}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </span>
          <button
            type="submit"
            disabled={!text.trim() || busy}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: text.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
              color: text.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
              cursor: text.trim() && !busy ? "pointer" : "default",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            Hold
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              background: filter === f.id ? "var(--ink)" : "transparent",
              color: filter === f.id ? "var(--bg)" : "var(--ink-2)",
              cursor: "pointer",
              letterSpacing: "0.4px",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--ink-3)",
          }}
        >
          Holding nothing right now. Carry better questions, get better answers.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              onPatch={(body) => patch(q.id, body)}
              onDelete={() => remove(q.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  q,
  onPatch,
  onDelete,
}: {
  q: Question;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerText, setAnswerText] = useState("");

  const tint = KIND_COLOR[q.kind];
  const dim = q.status === "answered" || q.status === "dropped";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderLeft: `3px solid ${tint}`,
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: dim ? 0.7 : 1,
      }}
    >
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 16,
          lineHeight: 1.4,
          color: "var(--ink)",
        }}
      >
        {q.text}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "0.4px",
        }}
      >
        <span style={{ padding: "2px 8px", borderRadius: 4, background: tint, color: "#0d0d10" }}>
          {KIND_LABEL[q.kind].toUpperCase()}
        </span>
        <span style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid var(--rule)" }}>
          {PRIORITY_LABEL[q.priority]}
        </span>
        <span style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid var(--rule)" }}>
          {q.status.toUpperCase()}
        </span>
        <span>{relTime(q.created_at)}</span>
      </div>

      {q.answer && (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink-2)",
            lineHeight: 1.5,
            padding: "10px 14px",
            background: "var(--bg)",
            borderRadius: 8,
            borderLeft: "2px solid #7affcb",
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              color: "var(--ink-3)",
              letterSpacing: "1.2px",
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            Answer
          </div>
          {q.answer}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {q.status === "open" && (
          <ActionBtn label="Exploring" onClick={() => onPatch({ status: "exploring" })} />
        )}
        {(q.status === "open" || q.status === "exploring") && (
          <>
            <ActionBtn label="Answer" onClick={() => setAnswerOpen((o) => !o)} />
            <ActionBtn label="Drop" onClick={() => onPatch({ status: "dropped" })} />
          </>
        )}
        {(q.status === "answered" || q.status === "dropped") && (
          <ActionBtn label="Reopen" onClick={() => onPatch({ answered: false })} />
        )}
        <button
          onClick={onDelete}
          style={{
            marginLeft: "auto",
            fontFamily: "var(--mono)",
            fontSize: 11,
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>

      {answerOpen && (
        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
          <textarea
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            placeholder="What did you learn? What's the answer?"
            rows={3}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              padding: "8px 12px",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--ink)",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setAnswerOpen(false);
                setAnswerText("");
              }}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--ink-3)",
                cursor: "pointer",
                letterSpacing: "0.4px",
              }}
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                await onPatch({ answered: true, answer: answerText.trim() || null });
                setAnswerOpen(false);
                setAnswerText("");
              }}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--rule)",
                background: "var(--ink)",
                color: "var(--bg)",
                cursor: "pointer",
                letterSpacing: "0.4px",
              }}
            >
              Mark answered
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--rule)",
        background: "transparent",
        color: "var(--ink-2)",
        cursor: "pointer",
        letterSpacing: "0.4px",
      }}
    >
      {label}
    </button>
  );
}
