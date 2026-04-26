"use client";

import { useCallback, useEffect, useState } from "react";

type Reflection = {
  id: string;
  text: string;
  kind: "lesson" | "regret" | "realisation" | "observation" | "gratitude" | "other";
  tags: string[];
  created_at: string;
};

const KIND_COLOR: Record<Reflection["kind"], string> = {
  lesson: "#7affcb",
  regret: "#f4a3a3",
  realisation: "#bfd4ee",
  observation: "var(--rule)",
  gratitude: "#f4c9d8",
  other: "var(--rule)",
};

const KIND_LABEL: Record<Reflection["kind"], string> = {
  lesson: "Lesson",
  regret: "Regret",
  realisation: "Realisation",
  observation: "Observation",
  gratitude: "Gratitude",
  other: "Other",
};

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

type FilterKind = "all" | Reflection["kind"];

export function ReflectionsConsole() {
  const [rows, setRows] = useState<Reflection[]>([]);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Reflection["kind"]>("lesson");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    const url = filter === "all" ? "/api/reflections" : `/api/reflections?kind=${filter}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Reflection[] };
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
      const res = await fetch("/api/reflections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, kind }),
      });
      if (res.ok) {
        setText("");
        setKind("lesson");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/reflections/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/reflections/${id}`, { method: "DELETE" });
    await load();
  };

  const filters: { id: FilterKind; label: string }[] = [
    { id: "all", label: "All" },
    { id: "lesson", label: "Lessons" },
    { id: "realisation", label: "Realisations" },
    { id: "regret", label: "Regrets" },
    { id: "observation", label: "Observations" },
    { id: "gratitude", label: "Gratitude" },
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
          What did today teach you?
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="The realisation, the lesson, the thing you'd tell yourself yesterday."
          rows={3}
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 17,
            padding: "10px 0",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--rule)",
            outline: "none",
            color: "var(--ink)",
            resize: "vertical",
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABEL) as Reflection["kind"][]).map((k) => (
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
          <button
            type="submit"
            disabled={!text.trim() || busy}
            style={{
              marginLeft: "auto",
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
            Keep
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
          Nothing kept yet. The unexamined day costs you the lesson.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((r) => {
            const tint = KIND_COLOR[r.kind];
            const isEditing = editingId === r.id;
            return (
              <div
                key={r.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule)",
                  borderLeft: `3px solid ${tint}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {isEditing ? (
                  <>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      style={{
                        fontFamily: "var(--serif)",
                        fontStyle: "italic",
                        fontSize: 16,
                        lineHeight: 1.5,
                        padding: "8px 10px",
                        border: "1px solid var(--rule)",
                        borderRadius: 6,
                        background: "var(--bg)",
                        color: "var(--ink)",
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditText("");
                        }}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          padding: "5px 12px",
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
                          const t = editText.trim();
                          if (!t) return;
                          await patch(r.id, { text: t });
                          setEditingId(null);
                          setEditText("");
                        }}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          padding: "5px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--rule)",
                          background: "var(--ink)",
                          color: "var(--bg)",
                          cursor: "pointer",
                          letterSpacing: "0.4px",
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 16,
                      lineHeight: 1.5,
                      color: "var(--ink)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {r.text}
                  </div>
                )}

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
                    {KIND_LABEL[r.kind].toUpperCase()}
                  </span>
                  <span>{relTime(r.created_at)}</span>
                  {!isEditing && (
                    <>
                      <button
                        onClick={() => {
                          setEditingId(r.id);
                          setEditText(r.text);
                        }}
                        style={{
                          marginLeft: "auto",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          background: "transparent",
                          border: "none",
                          color: "var(--ink-3)",
                          cursor: "pointer",
                          letterSpacing: "0.4px",
                        }}
                      >
                        edit
                      </button>
                      <button
                        onClick={() => remove(r.id)}
                        style={{
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
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
