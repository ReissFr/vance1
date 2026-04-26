"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Policy = {
  id: string;
  name: string;
  rule: string;
  category: string;
  priority: number;
  active: boolean;
  examples: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type Category =
  | "scheduling"
  | "communication"
  | "finance"
  | "health"
  | "relationships"
  | "work"
  | "general";

type CategoryFilter = Category | "all";
type ActiveFilter = "true" | "false" | "all";

const CATEGORIES: Category[] = [
  "scheduling",
  "communication",
  "finance",
  "health",
  "relationships",
  "work",
  "general",
];

const CATEGORY_COLOR: Record<Category, string> = {
  scheduling: "#bfd4ee",
  communication: "#e6d3e8",
  finance: "#7affcb",
  health: "#cfdcea",
  relationships: "#f4a3a3",
  work: "#f4c9d8",
  general: "#cccccc",
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

export function PoliciesConsole() {
  const [rows, setRows] = useState<Policy[]>([]);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("true");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [rule, setRule] = useState("");
  const [category, setCategory] = useState<Category>("general");
  const [priority, setPriority] = useState(3);
  const [examples, setExamples] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Policy | null>(null);

  const load = useCallback(async (active: ActiveFilter, cat: CategoryFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("active", active);
      if (cat !== "all") params.set("category", cat);
      const r = await fetch(`/api/policies?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`load failed (${r.status})`);
      const j = (await r.json()) as { rows: Policy[] };
      setRows(j.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(activeFilter, categoryFilter);
  }, [load, activeFilter, categoryFilter]);

  const grouped = useMemo(() => {
    const out: Record<Category, Policy[]> = {
      scheduling: [],
      communication: [],
      finance: [],
      health: [],
      relationships: [],
      work: [],
      general: [],
    };
    for (const r of rows) {
      const c = (CATEGORIES.includes(r.category as Category) ? r.category : "general") as Category;
      out[c].push(r);
    }
    return out;
  }, [rows]);

  const total = rows.length;
  const active = rows.filter((r) => r.active).length;

  async function submit() {
    if (!name.trim() || !rule.trim()) return;
    setSaving(true);
    try {
      const tags = tagsText
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12);
      const r = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rule: rule.trim(),
          category,
          priority,
          examples: examples.trim() || undefined,
          tags,
        }),
      });
      if (!r.ok) throw new Error(`save failed (${r.status})`);
      setName("");
      setRule("");
      setCategory("general");
      setPriority(3);
      setExamples("");
      setTagsText("");
      setShowForm(false);
      await load(activeFilter, categoryFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Policy) {
    await fetch(`/api/policies/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toggle: true }),
    });
    void load(activeFilter, categoryFilter);
  }

  async function remove(p: Policy) {
    if (!confirm(`Delete policy "${p.name}"?`)) return;
    await fetch(`/api/policies/${p.id}`, { method: "DELETE" });
    void load(activeFilter, categoryFilter);
  }

  async function saveEdit(payload: Record<string, unknown>) {
    if (!editing) return;
    await fetch(`/api/policies/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setEditing(null);
    void load(activeFilter, categoryFilter);
  }

  return (
    <div style={{ padding: "8px 0 64px", maxWidth: 920 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {(["true", "false", "all"] as ActiveFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "1.4px",
                textTransform: "uppercase",
                padding: "5px 11px",
                borderRadius: 5,
                border: "1px solid var(--rule)",
                background: activeFilter === f ? "var(--surface-2)" : "transparent",
                color: activeFilter === f ? "var(--ink)" : "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              {f === "true" ? "Active" : f === "false" ? "Inactive" : "All"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", ...CATEGORIES] as CategoryFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                padding: "5px 9px",
                borderRadius: 5,
                border: `1px solid ${
                  categoryFilter === c ? (c === "all" ? "var(--rule)" : CATEGORY_COLOR[c as Category]) : "var(--rule-soft)"
                }`,
                background: categoryFilter === c ? "var(--surface-2)" : "transparent",
                color: categoryFilter === c ? "var(--ink)" : "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.6px" }}>
          {active}/{total} active
        </div>

        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            padding: "6px 14px",
            borderRadius: 5,
            border: "1px solid var(--indigo)",
            background: showForm ? "var(--indigo)" : "transparent",
            color: showForm ? "var(--bg)" : "var(--indigo)",
            cursor: "pointer",
          }}
        >
          {showForm ? "Close" : "+ Policy"}
        </button>
      </div>

      {showForm && (
        <div
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 12,
            padding: 18,
            marginBottom: 26,
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            placeholder="Name (e.g. no-meetings-before-11)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 19,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink)",
            }}
          />
          <textarea
            placeholder="The rule itself (e.g. 'I don't take any meeting that starts before 11:00 London time. Decline politely or counter-propose 11:00+.')"
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            rows={3}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink)",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "1.2px",
                  textTransform: "uppercase",
                  padding: "5px 9px",
                  borderRadius: 5,
                  border: `1px solid ${category === c ? CATEGORY_COLOR[c] : "var(--rule)"}`,
                  background: category === c ? CATEGORY_COLOR[c] : "transparent",
                  color: category === c ? "var(--bg)" : "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "1.2px", textTransform: "uppercase" }}>
              Priority
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    width: 28,
                    height: 28,
                    borderRadius: 5,
                    border: `1px solid ${priority === p ? "var(--indigo)" : "var(--rule)"}`,
                    background: priority === p ? "var(--indigo)" : "transparent",
                    color: priority === p ? "var(--bg)" : "var(--ink-2)",
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            <span style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--ink-3)", fontStyle: "italic" }}>
              {priority === 5 ? "inviolable" : priority === 1 ? "soft preference" : "normal"}
            </span>
          </div>
          <textarea
            placeholder="Examples / triggers (optional — when does this fire?)"
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
            rows={2}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink)",
              resize: "vertical",
            }}
          />
          <input
            placeholder="Tags (comma-separated)"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink-2)",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowForm(false)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                padding: "7px 14px",
                borderRadius: 5,
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !name.trim() || !rule.trim()}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                padding: "7px 14px",
                borderRadius: 5,
                border: "1px solid var(--indigo)",
                background: "var(--indigo)",
                color: "var(--bg)",
                cursor: saving ? "wait" : "pointer",
                opacity: !name.trim() || !rule.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save policy"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "#ff6b6b", marginBottom: 14 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "1.2px" }}>
          LOADING…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            color: "var(--ink-3)",
            fontSize: 16,
            padding: "30px 0",
          }}
        >
          No policies yet. Add the rules you want JARVIS to enforce on your behalf — meeting hours, spend caps, who to decline, what time you stop replying.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {CATEGORIES.map((cat) => {
            const list = grouped[cat];
            if (list.length === 0) return null;
            return (
              <div key={cat}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: CATEGORY_COLOR[cat],
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      letterSpacing: "1.6px",
                      textTransform: "uppercase",
                      color: "var(--ink-2)",
                    }}
                  >
                    {cat}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--ink-3)",
                      letterSpacing: "0.6px",
                    }}
                  >
                    {list.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {list.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        border: "1px solid var(--rule)",
                        borderLeft: `3px solid ${CATEGORY_COLOR[cat]}`,
                        borderRadius: 8,
                        padding: "12px 14px",
                        background: "var(--surface)",
                        opacity: p.active ? 1 : 0.5,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                        <div
                          style={{
                            fontFamily: "var(--serif)",
                            fontStyle: "italic",
                            fontSize: 17,
                            color: "var(--ink)",
                            flex: 1,
                          }}
                        >
                          {p.name}
                        </div>
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 3,
                            border: "1px solid var(--rule)",
                            color: "var(--ink-3)",
                            letterSpacing: "0.6px",
                          }}
                        >
                          P{p.priority}
                        </span>
                        {!p.active && (
                          <span
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: 9.5,
                              padding: "2px 6px",
                              borderRadius: 3,
                              background: "var(--bg)",
                              color: "var(--ink-3)",
                              letterSpacing: "1.2px",
                              textTransform: "uppercase",
                            }}
                          >
                            inactive
                          </span>
                        )}
                      </div>
                      {editing?.id === p.id ? (
                        <EditForm policy={p} onCancel={() => setEditing(null)} onSave={saveEdit} />
                      ) : (
                        <>
                          <div
                            style={{
                              fontFamily: "var(--sans)",
                              fontSize: 13.5,
                              color: "var(--ink)",
                              lineHeight: 1.55,
                              marginBottom: p.examples ? 8 : 0,
                            }}
                          >
                            {p.rule}
                          </div>
                          {p.examples && (
                            <div
                              style={{
                                fontFamily: "var(--serif)",
                                fontStyle: "italic",
                                fontSize: 13,
                                color: "var(--ink-2)",
                                paddingLeft: 10,
                                borderLeft: `2px solid ${CATEGORY_COLOR[cat]}`,
                                lineHeight: 1.5,
                                marginBottom: 8,
                              }}
                            >
                              {p.examples}
                            </div>
                          )}
                          {p.tags.length > 0 && (
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                              {p.tags.map((t) => (
                                <span
                                  key={t}
                                  style={{
                                    fontFamily: "var(--mono)",
                                    fontSize: 9.5,
                                    padding: "1px 6px",
                                    borderRadius: 3,
                                    background: "var(--bg)",
                                    color: "var(--ink-3)",
                                    letterSpacing: "0.4px",
                                  }}
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontFamily: "var(--mono)",
                              fontSize: 10,
                              color: "var(--ink-3)",
                              letterSpacing: "0.5px",
                            }}
                          >
                            <span>updated {relTime(p.updated_at)}</span>
                            <div style={{ flex: 1 }} />
                            <button
                              onClick={() => toggleActive(p)}
                              style={{
                                fontFamily: "var(--mono)",
                                fontSize: 10,
                                letterSpacing: "1.2px",
                                textTransform: "uppercase",
                                padding: "3px 8px",
                                borderRadius: 4,
                                border: "1px solid var(--rule)",
                                background: "transparent",
                                color: "var(--ink-2)",
                                cursor: "pointer",
                              }}
                            >
                              {p.active ? "Pause" : "Activate"}
                            </button>
                            <button
                              onClick={() => setEditing(p)}
                              style={{
                                fontFamily: "var(--mono)",
                                fontSize: 10,
                                letterSpacing: "1.2px",
                                textTransform: "uppercase",
                                padding: "3px 8px",
                                borderRadius: 4,
                                border: "1px solid var(--rule)",
                                background: "transparent",
                                color: "var(--ink-2)",
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => remove(p)}
                              style={{
                                fontFamily: "var(--mono)",
                                fontSize: 11,
                                padding: "3px 8px",
                                borderRadius: 4,
                                border: "1px solid var(--rule)",
                                background: "transparent",
                                color: "var(--ink-3)",
                                cursor: "pointer",
                              }}
                              aria-label="delete"
                            >
                              ×
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
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
  policy,
  onCancel,
  onSave,
}: {
  policy: Policy;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(policy.name);
  const [rule, setRule] = useState(policy.rule);
  const [category, setCategory] = useState<Category>(
    (CATEGORIES.includes(policy.category as Category) ? policy.category : "general") as Category,
  );
  const [priority, setPriority] = useState(policy.priority);
  const [examples, setExamples] = useState(policy.examples ?? "");
  const [tagsText, setTagsText] = useState(policy.tags.join(", "));
  const [saving, setSaving] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 17,
          padding: "7px 9px",
          borderRadius: 6,
          border: "1px solid var(--rule)",
          background: "var(--bg)",
          color: "var(--ink)",
        }}
      />
      <textarea
        value={rule}
        onChange={(e) => setRule(e.target.value)}
        rows={3}
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          padding: "7px 9px",
          borderRadius: 6,
          border: "1px solid var(--rule)",
          background: "var(--bg)",
          color: "var(--ink)",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "1.2px",
              textTransform: "uppercase",
              padding: "5px 9px",
              borderRadius: 5,
              border: `1px solid ${category === c ? CATEGORY_COLOR[c] : "var(--rule)"}`,
              background: category === c ? CATEGORY_COLOR[c] : "transparent",
              color: category === c ? "var(--bg)" : "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "1.2px", textTransform: "uppercase" }}>
          Priority
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3, 4, 5].map((p) => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                width: 26,
                height: 26,
                borderRadius: 5,
                border: `1px solid ${priority === p ? "var(--indigo)" : "var(--rule)"}`,
                background: priority === p ? "var(--indigo)" : "transparent",
                color: priority === p ? "var(--bg)" : "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={examples}
        onChange={(e) => setExamples(e.target.value)}
        rows={2}
        placeholder="Examples / triggers"
        style={{
          fontFamily: "var(--sans)",
          fontSize: 12.5,
          padding: "7px 9px",
          borderRadius: 6,
          border: "1px solid var(--rule)",
          background: "var(--bg)",
          color: "var(--ink)",
          resize: "vertical",
        }}
      />
      <input
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
        placeholder="Tags (comma-separated)"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          padding: "6px 9px",
          borderRadius: 6,
          border: "1px solid var(--rule)",
          background: "var(--bg)",
          color: "var(--ink-2)",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.2px",
            textTransform: "uppercase",
            padding: "5px 12px",
            borderRadius: 5,
            border: "1px solid var(--rule)",
            background: "transparent",
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            setSaving(true);
            const tags = tagsText
              .split(/[,\n]/)
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 12);
            await onSave({
              name: name.trim(),
              rule: rule.trim(),
              category,
              priority,
              examples: examples.trim(),
              tags,
            });
            setSaving(false);
          }}
          disabled={saving}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.2px",
            textTransform: "uppercase",
            padding: "5px 12px",
            borderRadius: 5,
            border: "1px solid var(--indigo)",
            background: "var(--indigo)",
            color: "var(--bg)",
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
