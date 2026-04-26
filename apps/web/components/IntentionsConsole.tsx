"use client";

import { useCallback, useEffect, useState } from "react";

type Intention = {
  id: string;
  log_date: string;
  text: string;
  completed_at: string | null;
  carried_from: string | null;
  created_at: string;
  updated_at: string;
};

function todayLocalYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(dateStr: string): string {
  const today = todayLocalYMD();
  const yest = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  if (dateStr === today) return "Today";
  if (dateStr === yest) return "Yesterday";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function IntentionsConsole() {
  const [today, setToday] = useState<Intention | null>(null);
  const [rows, setRows] = useState<Intention[]>([]);
  const [suggested, setSuggested] = useState<Intention | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/intentions", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        today: Intention | null;
        rows: Intention[];
        suggested: Intention | null;
      };
      setToday(j.today);
      setRows(j.rows ?? []);
      setSuggested(j.suggested);
      if (j.today) setDraft(j.today.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (text: string, carriedFrom: string | null = null) => {
      const t = text.trim();
      if (!t) return;
      setSaving(true);
      setError(null);
      try {
        const r = await fetch("/api/intentions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: t, carried_from: carriedFrom }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const toggle = useCallback(
    async (id: string, completed: boolean) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, completed_at: completed ? new Date().toISOString() : null }
            : r,
        ),
      );
      if (today?.id === id) {
        setToday({ ...today, completed_at: completed ? new Date().toISOString() : null });
      }
      try {
        await fetch(`/api/intentions/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ completed }),
        });
      } catch {
        void load();
      }
    },
    [today, load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this intention?")) return;
      try {
        await fetch(`/api/intentions/${id}`, { method: "DELETE" });
      } finally {
        void load();
      }
    },
    [load],
  );

  const submitTodayForm = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void save(draft);
    },
    [draft, save],
  );

  const carryForward = useCallback(() => {
    if (!suggested) return;
    setDraft(suggested.text);
    void save(suggested.text, suggested.id);
  }, [suggested, save]);

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 720,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div
        style={{
          padding: "26px 28px",
          borderRadius: 16,
          background: "var(--panel)",
          border: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginBottom: 12,
          }}
        >
          Today&rsquo;s intention
        </div>
        {today ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
              padding: "16px 18px",
              borderRadius: 12,
              background: "var(--bg)",
              border: "1px solid var(--rule)",
            }}
          >
            <Checkbox
              checked={!!today.completed_at}
              onChange={(c) => void toggle(today.id, c)}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontStyle: "italic",
                  fontSize: 20,
                  color: "var(--ink)",
                  lineHeight: 1.4,
                  textDecorationLine: today.completed_at ? "line-through" : "none",
                  textDecorationColor: "var(--ink-3)",
                }}
              >
                {today.text}
              </div>
              {today.carried_from && (
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  Carried forward
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setDraft(today.text);
                setToday(null);
              }}
              style={{
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
              }}
            >
              Edit
            </button>
          </div>
        ) : (
          <form onSubmit={submitTodayForm} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="One thing I want to do today…"
              autoFocus
              maxLength={280}
              style={{
                width: "100%",
                padding: "14px 18px",
                borderRadius: 12,
                background: "var(--bg)",
                border: "1px solid var(--rule)",
                color: "var(--ink)",
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 18,
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {suggested && (
                <button
                  type="button"
                  onClick={carryForward}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    color: "var(--ink-2)",
                    border: "1px dashed var(--rule)",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                  title={`From ${dayLabel(suggested.log_date)}: "${suggested.text}"`}
                >
                  Carry forward yesterday&rsquo;s
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button
                type="submit"
                disabled={saving || !draft.trim()}
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
                {saving ? "Setting…" : "Set intention"}
              </button>
            </div>
          </form>
        )}
        {error && (
          <div style={{ marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "#ff6b6b" }}>
            {error}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: "var(--ink-3)",
              padding: "0 4px",
            }}
          >
            Recent
          </div>
          {rows
            .filter((r) => r.log_date !== todayLocalYMD())
            .map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "var(--panel)",
                  border: "1px solid var(--rule)",
                  opacity: r.completed_at ? 0.7 : 1,
                }}
              >
                <Checkbox checked={!!r.completed_at} onChange={(c) => void toggle(r.id, c)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--ink-3)",
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    {dayLabel(r.log_date)}
                    {r.carried_from && <span style={{ marginLeft: 6 }}>· carried</span>}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 15,
                      color: "var(--ink)",
                      lineHeight: 1.4,
                      textDecorationLine: r.completed_at ? "line-through" : "none",
                      textDecorationColor: "var(--ink-3)",
                    }}
                  >
                    {r.text}
                  </div>
                </div>
                <button
                  onClick={() => void remove(r.id)}
                  style={{
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
                  }}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            padding: "32px 24px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--ink-3)",
            border: "1px dashed var(--rule)",
            borderRadius: 14,
          }}
        >
          One sentence. What would make today feel done?
        </div>
      )}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{
        flexShrink: 0,
        width: 24,
        height: 24,
        borderRadius: 6,
        background: checked ? "#7affcb" : "transparent",
        border: `1px solid ${checked ? "#7affcb" : "var(--rule)"}`,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#000",
        fontFamily: "var(--sans)",
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {checked ? "✓" : ""}
    </button>
  );
}
