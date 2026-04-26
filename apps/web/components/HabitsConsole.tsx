"use client";

import { useCallback, useEffect, useState } from "react";

type Cadence = "daily" | "weekly";

type HabitRow = {
  id: string;
  name: string;
  cadence: Cadence;
  target_per_week: number;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  done_today: boolean;
  streak: number;
  week_count: number;
  recent: { date: string; done: boolean }[];
};

export function HabitsConsole() {
  const [habits, setHabits] = useState<HabitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newCadence, setNewCadence] = useState<Cadence>("daily");
  const [newTarget, setNewTarget] = useState(3);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/habits", { cache: "no-store" });
      const j = (await r.json()) as { habits: HabitRow[] };
      setHabits(j.habits ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(async (id: string) => {
    setHabits((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h;
        const nextDone = !h.done_today;
        const today = new Date().toISOString().slice(0, 10);
        const recent = h.recent.map((d) =>
          d.date === today ? { ...d, done: nextDone } : d,
        );
        return {
          ...h,
          done_today: nextDone,
          streak: nextDone ? h.streak + 1 : Math.max(0, h.streak - 1),
          week_count: nextDone ? h.week_count + 1 : Math.max(0, h.week_count - 1),
          recent,
        };
      }),
    );
    try {
      const r = await fetch(`/api/habits/${id}`, { method: "POST" });
      if (!r.ok) throw new Error(`http ${r.status}`);
      // Reconcile streak from server.
      load();
    } catch {
      load();
    }
  }, [load]);

  const archive = useCallback(async (id: string) => {
    if (!confirm("Archive this habit? It'll disappear from the list (logs kept).")) return;
    setHabits((p) => p.filter((h) => h.id !== id));
    try {
      await fetch(`/api/habits/${id}`, { method: "DELETE" });
    } finally {
      load();
    }
  }, [load]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/habits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          cadence: newCadence,
          target_per_week: newCadence === "weekly" ? newTarget : 7,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `http ${r.status}`);
      }
      setNewName("");
      setNewCadence("daily");
      setNewTarget(3);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setCreating(false);
    }
  }, [newName, newCadence, newTarget, load]);

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: 18,
          marginBottom: 22,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          placeholder="New habit (e.g. 'Read 30 min', 'Gym')"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          style={{
            flex: 1,
            minWidth: 200,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--panel)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--sans)",
            fontSize: 13,
          }}
        />
        <select
          value={newCadence}
          onChange={(e) => setNewCadence(e.target.value as Cadence)}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--panel)",
            border: "1px solid var(--rule)",
            color: "var(--ink-2)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        {newCadence === "weekly" && (
          <input
            type="number"
            min={1}
            max={7}
            value={newTarget}
            onChange={(e) => setNewTarget(Number(e.target.value))}
            title="target per week"
            style={{
              width: 64,
              padding: "10px 8px",
              borderRadius: 10,
              background: "var(--panel)",
              border: "1px solid var(--rule)",
              color: "var(--ink-2)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              textAlign: "center",
            }}
          />
        )}
        <button
          onClick={create}
          disabled={creating || !newName.trim()}
          style={{
            padding: "10px 22px",
            borderRadius: 10,
            background: "var(--ink)",
            color: "#000",
            border: "none",
            fontFamily: "var(--sans)",
            fontSize: 13,
            fontWeight: 500,
            cursor: creating ? "wait" : "pointer",
            opacity: creating || !newName.trim() ? 0.5 : 1,
          }}
        >
          {creating ? "Adding…" : "Add"}
        </button>
      </div>

      {error && (
        <div
          style={{
            color: "#ff6b6b",
            fontFamily: "var(--mono)",
            fontSize: 11,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 11 }}>
          Loading…
        </div>
      ) : habits.length === 0 ? (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--rule)",
            borderRadius: 12,
            padding: 32,
            color: "var(--ink-3)",
            fontFamily: "var(--sans)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          No habits yet. Add one above — "Read 30 min", "Gym", "Write morning journal".
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {habits.map((h) => (
            <HabitRow
              key={h.id}
              habit={h}
              onToggle={() => toggle(h.id)}
              onArchive={() => archive(h.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HabitRow({
  habit,
  onToggle,
  onArchive,
}: {
  habit: HabitRow;
  onToggle: () => void;
  onArchive: () => void;
}) {
  const cadenceHint =
    habit.cadence === "weekly"
      ? `${habit.week_count}/${habit.target_per_week} this week`
      : `${habit.streak} day${habit.streak === 1 ? "" : "s"} streak`;

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <button
        onClick={onToggle}
        aria-label={habit.done_today ? "Mark undone" : "Mark done"}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          border: habit.done_today
            ? "1px solid #7affcb"
            : "1px solid var(--rule)",
          background: habit.done_today ? "#7affcb" : "transparent",
          color: habit.done_today ? "#000" : "var(--ink-3)",
          fontFamily: "var(--mono)",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {habit.done_today ? "✓" : ""}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: "var(--ink)",
            fontFamily: "var(--sans)",
            fontSize: 14,
            marginBottom: 2,
          }}
        >
          {habit.name}
        </div>
        <div
          style={{
            color: "var(--ink-3)",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          {habit.cadence} · {cadenceHint}
        </div>
      </div>
      <div style={{ display: "flex", gap: 3 }} title="Last 14 days">
        {habit.recent.map((d) => (
          <div
            key={d.date}
            style={{
              width: 11,
              height: 22,
              borderRadius: 3,
              background: d.done ? "#7affcb" : "var(--rule)",
              opacity: d.done ? 1 : 0.45,
            }}
          />
        ))}
      </div>
      <button
        onClick={onArchive}
        title="Archive"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--ink-3)",
          fontFamily: "var(--mono)",
          fontSize: 14,
          cursor: "pointer",
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
