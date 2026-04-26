"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Theme = {
  id: string;
  title: string;
  kind: "work" | "personal" | "health" | "relationships" | "learning" | "creative" | "other";
  status: "active" | "paused" | "closed";
  description: string | null;
  current_state: string | null;
  outcome: string | null;
  closed_at: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

const KINDS: Theme["kind"][] = [
  "work",
  "personal",
  "health",
  "relationships",
  "learning",
  "creative",
  "other",
];

const KIND_COLOR: Record<Theme["kind"], string> = {
  work: "#bfd4ee",
  personal: "#f4c9d8",
  health: "#7affcb",
  relationships: "#f4a3a3",
  learning: "#e6d3e8",
  creative: "#cfdcea",
  other: "#aaa",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function ThemesConsole() {
  const [rows, setRows] = useState<Theme[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "paused" | "closed" | "all">("active");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Theme["kind"]>("work");
  const [description, setDescription] = useState("");
  const [currentState, setCurrentState] = useState("");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeOutcome, setCloseOutcome] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/themes?status=${statusFilter}`);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Theme[] };
    setRows(json.rows ?? []);
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const tags = tagText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: t,
          kind,
          description: description.trim() || null,
          current_state: currentState.trim() || null,
          tags,
        }),
      });
      if (res.ok) {
        setTitle("");
        setKind("work");
        setDescription("");
        setCurrentState("");
        setTagText("");
        setShowForm(false);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    await fetch(`/api/themes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/themes/${id}`, { method: "DELETE" });
    await load();
  };

  const closeTheme = async (id: string) => {
    await patch(id, { close: true, outcome: closeOutcome.trim() || null });
    setClosingId(null);
    setCloseOutcome("");
  };

  const counts = useMemo(() => {
    const m: Record<Theme["kind"], number> = {
      work: 0,
      personal: 0,
      health: 0,
      relationships: 0,
      learning: 0,
      creative: 0,
      other: 0,
    };
    for (const r of rows) m[r.kind] = (m[r.kind] ?? 0) + 1;
    return m;
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "8px 4px 80px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["active", "paused", "closed", "all"] as const).map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--bg)" : "var(--ink-2)",
                  cursor: "pointer",
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            marginLeft: "auto",
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid var(--rule)",
            background: showForm ? "var(--surface-2)" : "transparent",
            color: "var(--ink-2)",
            cursor: "pointer",
            letterSpacing: "0.6px",
            textTransform: "uppercase",
          }}
        >
          {showForm ? "× Close" : "+ Theme"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 14,
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
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
            New theme — what you're living through
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ending the agency"
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 17,
              padding: "8px 10px",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: `1px solid ${kind === k ? KIND_COLOR[k] : "var(--rule)"}`,
                  background: kind === k ? KIND_COLOR[k] : "transparent",
                  color: kind === k ? "#1a1a1a" : "var(--ink-3)",
                  cursor: "pointer",
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this theme is about — the static framing"
            rows={2}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              padding: "8px 10px",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--ink)",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <textarea
            value={currentState}
            onChange={(e) => setCurrentState(e.target.value)}
            placeholder="Current state — where you are right now in this story (mutable)"
            rows={3}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              padding: "8px 10px",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--ink)",
              outline: "none",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="tags, comma, separated"
              style={{
                flex: 1,
                minWidth: 200,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                padding: "6px 10px",
                border: "1px solid var(--rule)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--ink)",
                outline: "none",
                letterSpacing: "0.3px",
              }}
            />
            <button
              type="submit"
              disabled={!title.trim() || busy}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--rule)",
                background: title.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
                color: title.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
                cursor: title.trim() && !busy ? "pointer" : "default",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
              }}
            >
              Save
            </button>
          </div>
        </form>
      )}

      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "1.4px",
          textTransform: "uppercase",
        }}
      >
        {rows.length} {statusFilter === "all" ? "" : statusFilter} theme{rows.length === 1 ? "" : "s"}
        {Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => ` · ${n} ${k}`)
          .join("")}
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
          {statusFilter === "active"
            ? "No active themes. Name the story arcs you're living through and JARVIS will track them."
            : `No ${statusFilter} themes.`}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((t) => {
            const editing = editingId === t.id;
            const closing = closingId === t.id;
            const color = KIND_COLOR[t.kind];
            return (
              <div
                key={t.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule)",
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 10,
                  padding: "16px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  opacity: t.status === "closed" ? 0.7 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 19,
                      color: "var(--ink)",
                      letterSpacing: "-0.2px",
                      textDecoration: t.status === "closed" ? "line-through" : "none",
                    }}
                  >
                    {t.title}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9.5,
                      color: "var(--ink-3)",
                      letterSpacing: "1.4px",
                      textTransform: "uppercase",
                    }}
                  >
                    {t.kind}
                  </span>
                  {t.status !== "active" && (
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 9.5,
                        padding: "1px 6px",
                        borderRadius: 4,
                        border: "1px solid var(--rule)",
                        color: "var(--ink-3)",
                        letterSpacing: "0.8px",
                        textTransform: "uppercase",
                      }}
                    >
                      {t.status}
                    </span>
                  )}
                  {t.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        border: "1px solid var(--rule)",
                        color: "var(--ink-3)",
                        letterSpacing: "0.3px",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      letterSpacing: "0.4px",
                    }}
                  >
                    updated {relTime(t.updated_at)}
                  </span>
                </div>

                {editing ? (
                  <EditForm
                    theme={t}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      await patch(t.id, payload);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    {t.description && (
                      <div
                        style={{
                          fontFamily: "var(--sans)",
                          fontSize: 13.5,
                          color: "var(--ink-2)",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {t.description}
                      </div>
                    )}
                    {t.current_state && (
                      <div
                        style={{
                          fontFamily: "var(--serif)",
                          fontSize: 14.5,
                          color: "var(--ink)",
                          lineHeight: 1.55,
                          whiteSpace: "pre-wrap",
                          padding: "10px 12px",
                          background: "var(--bg)",
                          borderRadius: 6,
                          borderLeft: `2px solid ${color}`,
                        }}
                      >
                        {t.current_state}
                      </div>
                    )}
                    {t.outcome && (
                      <div
                        style={{
                          fontFamily: "var(--serif)",
                          fontStyle: "italic",
                          fontSize: 13.5,
                          color: "var(--ink-2)",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        — outcome: {t.outcome}
                      </div>
                    )}
                  </>
                )}

                {closing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={closeOutcome}
                      onChange={(e) => setCloseOutcome(e.target.value)}
                      placeholder="Outcome (optional) — what came of this thread"
                      rows={3}
                      style={{
                        fontFamily: "var(--sans)",
                        fontSize: 13,
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
                          setClosingId(null);
                          setCloseOutcome("");
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
                        onClick={() => closeTheme(t.id)}
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
                        Close theme
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {t.status === "active" && (
                      <button
                        onClick={() => patch(t.id, { status: "paused" })}
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
                        Pause
                      </button>
                    )}
                    {t.status === "paused" && (
                      <button
                        onClick={() => patch(t.id, { status: "active" })}
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
                        Resume
                      </button>
                    )}
                    {t.status === "closed" ? (
                      <button
                        onClick={() => patch(t.id, { reopen: true })}
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
                        Reopen
                      </button>
                    ) : (
                      <button
                        onClick={() => setClosingId(t.id)}
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
                        Close
                      </button>
                    )}
                    <button
                      onClick={() => setEditingId(editing ? null : t.id)}
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
                      {editing ? "Cancel edit" : "Edit"}
                    </button>
                    <button
                      onClick={() => remove(t.id)}
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditForm({
  theme,
  onCancel,
  onSave,
}: {
  theme: Theme;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(theme.title);
  const [kind, setKind] = useState<Theme["kind"]>(theme.kind);
  const [description, setDescription] = useState(theme.description ?? "");
  const [currentState, setCurrentState] = useState(theme.current_state ?? "");
  const [tagText, setTagText] = useState(theme.tags.join(", "));
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 17,
          padding: "6px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${kind === k ? KIND_COLOR[k] : "var(--rule)"}`,
              background: kind === k ? KIND_COLOR[k] : "transparent",
              color: kind === k ? "#1a1a1a" : "var(--ink-3)",
              cursor: "pointer",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={2}
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          padding: "8px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
          resize: "vertical",
          lineHeight: 1.5,
        }}
      />
      <textarea
        value={currentState}
        onChange={(e) => setCurrentState(e.target.value)}
        placeholder="Current state"
        rows={3}
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          padding: "8px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
          resize: "vertical",
          lineHeight: 1.5,
        }}
      />
      <input
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        placeholder="tags, comma, separated"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          padding: "6px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
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
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const tags = tagText
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              await onSave({
                title: title.trim(),
                kind,
                description: description.trim() || null,
                current_state: currentState.trim() || null,
                tags,
              });
            } finally {
              setBusy(false);
            }
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
    </div>
  );
}
