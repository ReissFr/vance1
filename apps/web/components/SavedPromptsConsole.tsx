"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SavedPrompt = {
  id: string;
  name: string;
  body: string;
  description: string | null;
  tags: string[];
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function relTime(iso: string | null): string {
  if (!iso) return "never used";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function SavedPromptsConsole() {
  const [rows, setRows] = useState<SavedPrompt[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [description, setDescription] = useState("");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = search.trim() ? `/api/saved-prompts?q=${encodeURIComponent(search.trim())}` : "/api/saved-prompts";
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: SavedPrompt[] };
    setRows(json.rows ?? []);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const b = body.trim();
    if (!n || !b || busy) return;
    setBusy(true);
    try {
      const tags = tagText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/saved-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n, body: b, description: description.trim() || null, tags }),
      });
      if (res.ok) {
        setName("");
        setBody("");
        setDescription("");
        setTagText("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    await fetch(`/api/saved-prompts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/saved-prompts/${id}`, { method: "DELETE" });
    await load();
  };

  const copyAndStamp = async (p: SavedPrompt) => {
    try {
      await navigator.clipboard.writeText(p.body);
    } catch {
      /* clipboard might be denied; still stamp use */
    }
    await fetch(`/api/saved-prompts/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ used: true }),
    });
    await load();
  };

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

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
          New prompt — fire-able by name
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="friday-recap"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            padding: "8px 10px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
            letterSpacing: "0.4px",
          }}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional) — what this prompt does"
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            padding: "8px 10px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Summarise this week's wins, biggest blockers, and the single most important thing for next week. Pull from /wins, /reflections, /loops."
          rows={6}
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            padding: "10px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
            lineHeight: 1.5,
            resize: "vertical",
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
            disabled={!name.trim() || !body.trim() || busy}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: name.trim() && body.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
              color: name.trim() && body.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
              cursor: name.trim() && body.trim() && !busy ? "pointer" : "default",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            Save
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, body, description"
          style={{
            flex: 1,
            minWidth: 200,
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            padding: "8px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        {tagCounts.length > 0 && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "1.4px" }}>
            {rows.length} prompts · {tagCounts.length} tags
          </span>
        )}
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
          No saved prompts yet. The third time you type the same instruction, save it.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((p) => {
            const open = openId === p.id;
            const editing = editingId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule)",
                  borderRadius: 10,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      color: "var(--ink)",
                      letterSpacing: "0.4px",
                      fontWeight: 500,
                    }}
                  >
                    {p.name}
                  </span>
                  {p.tags.map((t) => (
                    <span
                      key={t}
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
                      {t}
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
                    {p.use_count}× · {relTime(p.last_used_at)}
                  </span>
                </div>

                {p.description && (
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 14,
                      color: "var(--ink-2)",
                      lineHeight: 1.4,
                    }}
                  >
                    {p.description}
                  </div>
                )}

                {editing ? (
                  <EditForm
                    prompt={p}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      await patch(p.id, payload);
                      setEditingId(null);
                    }}
                  />
                ) : open ? (
                  <pre
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "var(--ink-2)",
                      background: "var(--bg)",
                      padding: "10px 12px",
                      borderRadius: 6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      border: "1px solid var(--rule)",
                      margin: 0,
                    }}
                  >
                    {p.body}
                  </pre>
                ) : null}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={() => copyAndStamp(p)}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      padding: "4px 12px",
                      borderRadius: 6,
                      border: "1px solid var(--rule)",
                      background: "var(--ink)",
                      color: "var(--bg)",
                      cursor: "pointer",
                      letterSpacing: "0.4px",
                    }}
                  >
                    Copy &amp; mark used
                  </button>
                  <button
                    onClick={() => setOpenId(open ? null : p.id)}
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
                    {open ? "Hide body" : "Show body"}
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(editing ? null : p.id);
                      setOpenId(p.id);
                    }}
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
                    onClick={() => remove(p.id)}
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditForm({
  prompt,
  onCancel,
  onSave,
}: {
  prompt: SavedPrompt;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(prompt.name);
  const [body, setBody] = useState(prompt.body);
  const [description, setDescription] = useState(prompt.description ?? "");
  const [tagText, setTagText] = useState(prompt.tags.join(", "));
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 13,
          padding: "6px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
        }}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          padding: "6px 10px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
        }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12,
          padding: "10px 12px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
          lineHeight: 1.5,
          resize: "vertical",
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
                .map((t) => t.trim())
                .filter(Boolean);
              await onSave({ name: name.trim(), body: body.trim(), description: description.trim() || null, tags });
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
