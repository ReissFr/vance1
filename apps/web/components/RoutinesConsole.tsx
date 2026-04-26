"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Routine = {
  id: string;
  name: string;
  description: string | null;
  steps: string[];
  tags: string[];
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function relTime(iso: string | null): string {
  if (!iso) return "never run";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function RoutinesConsole() {
  const [rows, setRows] = useState<Routine[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, Set<number>>>({});

  const load = useCallback(async () => {
    const url = search.trim() ? `/api/routines?q=${encodeURIComponent(search.trim())}` : "/api/routines";
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Routine[] };
    setRows(json.rows ?? []);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const steps = stepsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!n || steps.length === 0 || busy) return;
    setBusy(true);
    try {
      const tags = tagText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n, description: description.trim() || null, steps, tags }),
      });
      if (res.ok) {
        setName("");
        setDescription("");
        setStepsText("");
        setTagText("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    await fetch(`/api/routines/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/routines/${id}`, { method: "DELETE" });
    await load();
  };

  const startRun = (r: Routine) => {
    setRunningId(r.id);
    setChecked((prev) => ({ ...prev, [r.id]: new Set() }));
  };

  const toggleStep = (rid: string, idx: number) => {
    setChecked((prev) => {
      const cur = new Set(prev[rid] ?? []);
      if (cur.has(idx)) cur.delete(idx);
      else cur.add(idx);
      return { ...prev, [rid]: cur };
    });
  };

  const finishRun = async (r: Routine) => {
    await fetch(`/api/routines/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ used: true }),
    });
    setRunningId(null);
    setChecked((prev) => {
      const next = { ...prev };
      delete next[r.id];
      return next;
    });
    await load();
  };

  const cancelRun = (rid: string) => {
    setRunningId(null);
    setChecked((prev) => {
      const next = { ...prev };
      delete next[rid];
      return next;
    });
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
          New routine — fire-able by name
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="morning-publish"
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
          placeholder="Description (optional) — when this routine fires"
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
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          placeholder={"Steps — one per line, in order\nCheck overnight email + DMs\nDraft today's intention\nLog yesterday's standup\nQueue ideas in /ideas"}
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
            lineHeight: 1.55,
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
            disabled={!name.trim() || !stepsText.trim() || busy}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: name.trim() && stepsText.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
              color: name.trim() && stepsText.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
              cursor: name.trim() && stepsText.trim() && !busy ? "pointer" : "default",
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
          placeholder="Search by name or description"
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
        {rows.length > 0 && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "1.4px" }}>
            {rows.length} routines · {tagCounts.length} tags
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
          No routines yet. The third time you walk through the same checklist, save it.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((r) => {
            const editing = editingId === r.id;
            const running = runningId === r.id;
            const set = checked[r.id] ?? new Set<number>();
            const allDone = set.size === r.steps.length && r.steps.length > 0;
            return (
              <div
                key={r.id}
                style={{
                  background: "var(--surface)",
                  border: `1px solid ${running ? "var(--indigo)" : "var(--rule)"}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
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
                    {r.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      letterSpacing: "0.4px",
                    }}
                  >
                    {r.steps.length} step{r.steps.length === 1 ? "" : "s"}
                  </span>
                  {r.tags.map((t) => (
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
                    {r.use_count}× · {relTime(r.last_used_at)}
                  </span>
                </div>

                {r.description && (
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 14,
                      color: "var(--ink-2)",
                      lineHeight: 1.4,
                    }}
                  >
                    {r.description}
                  </div>
                )}

                {editing ? (
                  <EditForm
                    routine={r}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      await patch(r.id, payload);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {r.steps.map((step, i) => {
                      const done = set.has(i);
                      return (
                        <li
                          key={i}
                          onClick={running ? () => toggleStep(r.id, i) : undefined}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            padding: "6px 8px",
                            borderRadius: 6,
                            background: running && done ? "var(--bg)" : "transparent",
                            cursor: running ? "pointer" : "default",
                            opacity: running && done ? 0.55 : 1,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: 11,
                              color: running && done ? "var(--indigo)" : "var(--ink-3)",
                              minWidth: 22,
                              letterSpacing: "0.3px",
                            }}
                          >
                            {running ? (done ? "✓" : `${i + 1}.`) : `${i + 1}.`}
                          </span>
                          <span
                            style={{
                              fontFamily: "var(--sans)",
                              fontSize: 13.5,
                              color: "var(--ink-2)",
                              lineHeight: 1.45,
                              textDecoration: running && done ? "line-through" : "none",
                              flex: 1,
                            }}
                          >
                            {step}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {running ? (
                    <>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          color: "var(--ink-3)",
                          letterSpacing: "0.4px",
                        }}
                      >
                        {set.size} / {r.steps.length}
                      </span>
                      <button
                        onClick={() => finishRun(r)}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          padding: "4px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--rule)",
                          background: allDone ? "var(--ink)" : "var(--surface-2)",
                          color: allDone ? "var(--bg)" : "var(--ink-2)",
                          cursor: "pointer",
                          letterSpacing: "0.4px",
                        }}
                      >
                        Done — mark as run
                      </button>
                      <button
                        onClick={() => cancelRun(r.id)}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          padding: "4px 10px",
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
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startRun(r)}
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
                        Run now
                      </button>
                      <button
                        onClick={() => setEditingId(editing ? null : r.id)}
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
                        onClick={() => remove(r.id)}
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

function EditForm({
  routine,
  onCancel,
  onSave,
}: {
  routine: Routine;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(routine.name);
  const [description, setDescription] = useState(routine.description ?? "");
  const [stepsText, setStepsText] = useState(routine.steps.join("\n"));
  const [tagText, setTagText] = useState(routine.tags.join(", "));
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
        value={stepsText}
        onChange={(e) => setStepsText(e.target.value)}
        rows={Math.max(6, routine.steps.length + 2)}
        placeholder="One step per line"
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          padding: "10px 12px",
          border: "1px solid var(--rule)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--ink)",
          outline: "none",
          lineHeight: 1.55,
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
              const steps = stepsText
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              const tags = tagText
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              await onSave({
                name: name.trim(),
                description: description.trim() || null,
                steps,
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
