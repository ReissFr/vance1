"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Standup = {
  id: string;
  log_date: string;
  yesterday: string | null;
  today: string | null;
  blockers: string | null;
  created_at: string;
  updated_at: string;
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function formatDateLabel(ymd: string): string {
  const d = ymdToDate(ymd);
  const today = todayYmd();
  if (ymd === today) return "Today";
  const yesterday = (() => {
    const x = new Date();
    x.setDate(x.getDate() - 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  })();
  if (ymd === yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function StandupConsole() {
  const [rows, setRows] = useState<Standup[]>([]);
  const [yesterday, setYesterday] = useState("");
  const [today, setToday] = useState("");
  const [blockers, setBlockers] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/standups?days=21");
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Standup[] };
    setRows(json.rows ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const todaysRow = useMemo(() => rows.find((r) => r.log_date === todayYmd()) ?? null, [rows]);

  useEffect(() => {
    if (todaysRow) {
      setYesterday(todaysRow.yesterday ?? "");
      setToday(todaysRow.today ?? "");
      setBlockers(todaysRow.blockers ?? "");
    }
  }, [todaysRow?.id]);

  // Autofill yesterday from the most recent prior standup's "today" field — a
  // gentle nudge to carry forward what was promised.
  const previousTodayHint = useMemo(() => {
    const prior = rows.find((r) => r.log_date !== todayYmd());
    return prior?.today ?? null;
  }, [rows]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!yesterday.trim() && !today.trim() && !blockers.trim()) || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/standups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          yesterday: yesterday.trim() || null,
          today: today.trim() || null,
          blockers: blockers.trim() || null,
        }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/standups/${id}`, { method: "DELETE" });
    await load();
  };

  const blockersOpen = useMemo(
    () => rows.filter((r) => r.blockers && r.blockers.trim()).slice(0, 5),
    [rows],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px 80px" }}>
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
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
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
            {todaysRow ? "Today's standup — saved, edits overwrite" : "Today's standup"}
          </div>
          {todaysRow && (
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-3)",
                letterSpacing: "0.4px",
              }}
            >
              last updated {new Date(todaysRow.updated_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>

        <Field label="Yesterday — what got done?" hint={previousTodayHint && !todaysRow ? `Yesterday's plan was: "${previousTodayHint.slice(0, 200)}"` : undefined}>
          <textarea
            value={yesterday}
            onChange={(e) => setYesterday(e.target.value)}
            placeholder="Shipped X. Closed Y. Started Z."
            rows={3}
            style={textareaStyle}
          />
        </Field>

        <Field label="Today — what's the focus?">
          <textarea
            value={today}
            onChange={(e) => setToday(e.target.value)}
            placeholder="Push X live. Call Y. Draft Z."
            rows={3}
            style={textareaStyle}
          />
        </Field>

        <Field label="Blockers — what's stuck?" hint="Leave empty if none. Naming a blocker is half of solving it.">
          <textarea
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            placeholder="Waiting on X. Don't know how to Y."
            rows={2}
            style={{ ...textareaStyle, borderColor: blockers.trim() ? "#f4a3a3" : "var(--rule)" }}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={(!yesterday.trim() && !today.trim() && !blockers.trim()) || busy}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "8px 18px",
              borderRadius: 8,
              border: "1px solid var(--rule)",
              background:
                (yesterday.trim() || today.trim() || blockers.trim()) && !busy
                  ? "var(--ink)"
                  : "var(--surface-2)",
              color:
                (yesterday.trim() || today.trim() || blockers.trim()) && !busy
                  ? "var(--bg)"
                  : "var(--ink-3)",
              cursor: (yesterday.trim() || today.trim() || blockers.trim()) && !busy ? "pointer" : "default",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            {todaysRow ? "Save" : "Log standup"}
          </button>
        </div>
      </form>

      {blockersOpen.length > 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderLeft: "3px solid #f4a3a3",
            borderRadius: 12,
            padding: "12px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              color: "#f4a3a3",
              textTransform: "uppercase",
            }}
          >
            Recent blockers ({blockersOpen.length})
          </div>
          {blockersOpen.map((r) => (
            <div key={r.id} style={{ fontFamily: "var(--sans)", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  letterSpacing: "0.4px",
                  marginRight: 8,
                }}
              >
                {formatDateLabel(r.log_date)} ·
              </span>
              {r.blockers}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.6px",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            padding: "0 4px",
          }}
        >
          Past 21 days
        </div>
        {rows.length === 0 ? (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 16,
              color: "var(--ink-3)",
            }}
          >
            No standups yet. Tomorrow you'll be glad you started.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--rule)",
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: "0.6px",
                    color: "var(--ink-2)",
                    textTransform: "uppercase",
                  }}
                >
                  {formatDateLabel(r.log_date)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--ink-3)",
                    letterSpacing: "0.3px",
                  }}
                >
                  {r.log_date}
                </span>
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
              </div>
              {r.yesterday && (
                <Block label="Yesterday" body={r.yesterday} colour="var(--ink-3)" />
              )}
              {r.today && <Block label="Today" body={r.today} colour="#bfd4ee" />}
              {r.blockers && <Block label="Blockers" body={r.blockers} colour="#f4a3a3" />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-2)", fontWeight: 500 }}>
        {label}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 12.5,
            color: "var(--ink-3)",
            lineHeight: 1.4,
          }}
        >
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

function Block({ label, body, colour }: { label: string; body: string; colour: string }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: colour,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          width: 70,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          color: "var(--ink-2)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </span>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
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
  width: "100%",
  boxSizing: "border-box",
};
