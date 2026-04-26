"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  date_type: "birthday" | "anniversary" | "custom";
  month: number;
  day: number;
  year: number | null;
  lead_days: number;
  last_notified_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  days_until_next: number;
  turning_age: number | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TYPE_COLORS: Record<Row["date_type"], string> = {
  birthday: "#f4c9d8",
  anniversary: "#e6d3e8",
  custom: "#bfd4ee",
};

function dueLabel(days: number): { text: string; tone: "today" | "soon" | "later" } {
  if (days === 0) return { text: "today", tone: "today" };
  if (days === 1) return { text: "tomorrow", tone: "today" };
  if (days <= 7) return { text: `in ${days} days`, tone: "soon" };
  if (days <= 30) return { text: `in ${days}d`, tone: "later" };
  if (days <= 60) return { text: `in ~${Math.round(days / 7)}w`, tone: "later" };
  return { text: `in ${Math.round(days / 30)}mo`, tone: "later" };
}

export function BirthdaysConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [dateType, setDateType] = useState<Row["date_type"]>("birthday");
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [day, setDay] = useState<number>(new Date().getDate());
  const [year, setYear] = useState<string>("");
  const [leadDays, setLeadDays] = useState<number>(7);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/dates", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { rows: Row[] };
      setRows(j.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = useCallback(() => {
    setName("");
    setDateType("birthday");
    const d = new Date();
    setMonth(d.getMonth() + 1);
    setDay(d.getDate());
    setYear("");
    setLeadDays(7);
    setNote("");
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const t = name.trim();
      if (!t) return;
      setSaving(true);
      setError(null);
      try {
        const yearNum = year.trim() ? Number(year) : null;
        const r = await fetch("/api/dates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: t,
            date_type: dateType,
            month,
            day,
            year: yearNum,
            lead_days: leadDays,
            note: note.trim() || null,
          }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        reset();
        setShowForm(false);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [name, dateType, month, day, year, leadDays, note, load, reset],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this date?")) return;
      try {
        await fetch(`/api/dates/${id}`, { method: "DELETE" });
      } finally {
        void load();
      }
    },
    [load],
  );

  const upcoming30 = rows.filter((r) => r.days_until_next <= 30);
  const later = rows.filter((r) => r.days_until_next > 30);

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
          {showForm ? "Cancel" : "Add a date"}
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
          <Field label="Whose date" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={120}
              placeholder="e.g. Mum, Sarah, Wedding"
              style={inputStyle}
            />
          </Field>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(["birthday", "anniversary", "custom"] as const).map((t) => {
              const active = dateType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDateType(t)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 16,
                    background: active ? TYPE_COLORS[t] : "transparent",
                    color: active ? "#000" : "var(--ink-2)",
                    border: `1px solid ${active ? TYPE_COLORS[t] : "var(--rule)"}`,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Field label="Month">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                style={inputStyle}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Day">
              <input
                type="number"
                min={1}
                max={31}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="Year (optional)">
              <input
                type="number"
                min={1900}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="for age"
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              Nudge me
            </span>
            {[1, 3, 7, 14].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setLeadDays(n)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 16,
                  background: leadDays === n ? "var(--ink)" : "transparent",
                  color: leadDays === n ? "#000" : "var(--ink-2)",
                  border: `1px solid ${leadDays === n ? "var(--ink)" : "var(--rule)"}`,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {n}d before
              </button>
            ))}
          </div>
          <Field label="Note">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Gift idea, what they like, where they live"
              style={textareaStyle}
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={saving || !name.trim()}
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
              {saving ? "Saving…" : "Add date"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      )}

      {upcoming30.length > 0 && (
        <Section label="Next 30 days">
          {upcoming30.map((r) => (
            <DateCard key={r.id} row={r} onDelete={() => void remove(r.id)} />
          ))}
        </Section>
      )}

      {later.length > 0 && (
        <Section label="Later this year">
          {later.map((r) => (
            <DateCard key={r.id} row={r} onDelete={() => void remove(r.id)} />
          ))}
        </Section>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            padding: "36px 24px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--ink-3)",
            border: "1px dashed var(--rule)",
            borderRadius: 14,
          }}
        >
          Add the dates that matter — JARVIS will nudge you before each one.
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
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
        {label}
      </div>
      {children}
    </div>
  );
}

function DateCard({ row, onDelete }: { row: Row; onDelete: () => void }) {
  const due = dueLabel(row.days_until_next);
  const dueColor =
    due.tone === "today" ? "#7affcb" : due.tone === "soon" ? "#f4c9d8" : "var(--ink-3)";
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 12,
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 56,
          height: 56,
          borderRadius: 12,
          background: TYPE_COLORS[row.date_type],
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#000",
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            opacity: 0.7,
          }}
        >
          {MONTHS[row.month - 1]}
        </div>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, lineHeight: 1 }}>
          {row.day}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--ink)",
          }}
        >
          {row.name}
          {row.turning_age != null && (
            <span style={{ color: "var(--ink-3)", marginLeft: 8, fontSize: 14 }}>
              turns {row.turning_age}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: dueColor,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            marginTop: 2,
          }}
        >
          {due.text} · nudge {row.lead_days}d before
        </div>
        {row.note && (
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {row.note}
          </div>
        )}
      </div>
      <button
        onClick={onDelete}
        style={{
          padding: "5px 10px",
          borderRadius: 6,
          background: "transparent",
          color: "var(--ink-3)",
          border: "1px solid var(--rule)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          cursor: "pointer",
        }}
      >
        ×
      </button>
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
    <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
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
  minHeight: 56,
};
