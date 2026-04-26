"use client";

// WatchersConsole: two panes — preset templates (fast-path creation) on top,
// the user's armed rules list below. The presets call /api/watchers/create;
// the list calls /api/watchers/list + toggle for enable/disable/delete.
//
// Templates use a compact inline form: each card has 0–3 fields, plus a
// primary "Arm" button. No full-page editor — the brain is the place to
// compose arbitrary trigger_spec/action_chain combinations.

import { useCallback, useEffect, useState } from "react";

type WatcherRow = {
  id: string;
  title: string;
  description: string | null;
  trigger_kind: string;
  trigger_spec: Record<string, unknown>;
  ask_first: boolean;
  enabled: boolean;
  last_fired_at: string | null;
  last_checked_at: string | null;
  fire_count: number;
};

type PresetId =
  | "wake_up_call"
  | "evening_wrap"
  | "meeting_intel"
  | "price_watch"
  | "photo_inbox"
  | "group_chat_mode";

type PresetField = {
  name: string;
  label: string;
  placeholder?: string;
  kind?: "text" | "time" | "number";
  required?: boolean;
  default?: string;
};

type PresetDef = {
  id: PresetId;
  title: string;
  blurb: string;
  example: string;
  fields: PresetField[];
};

const PRESETS: PresetDef[] = [
  {
    id: "wake_up_call",
    title: "Wake-up call",
    blurb: "JARVIS phones you every morning and reads your brief. Speak back to reply.",
    example: "e.g. 07:30 daily — \"Morning. Big day. Your first meeting is at 09:15.\"",
    fields: [
      { name: "time_local", label: "Time (24h)", kind: "time", default: "07:30" },
      { name: "call_script", label: "Script (optional)", placeholder: "What JARVIS should say when you pick up" },
    ],
  },
  {
    id: "evening_wrap",
    title: "Evening wrap",
    blurb: "A short WhatsApp digest every evening: what happened + what's tomorrow.",
    example: "e.g. 21:30 daily — today's finished tasks, inbound messages, tomorrow's schedule.",
    fields: [{ name: "time_local", label: "Time (24h)", kind: "time", default: "21:30" }],
  },
  {
    id: "meeting_intel",
    title: "Meeting intel",
    blurb: "Before every calendar event, pre-brief you on attendees, recent threads, talking points.",
    example: "e.g. 10 min before anything with \"sales\" in the title.",
    fields: [
      { name: "minutes_before", label: "Minutes before", kind: "number", default: "10" },
      { name: "title_contains", label: "Title filter (optional)", placeholder: "sales, standup, 1:1…" },
    ],
  },
  {
    id: "price_watch",
    title: "Watch anything",
    blurb: "Describe any condition in English. JARVIS checks on a loop and pings you when it matches.",
    example: "e.g. \"BA flight LHR→HND in Dec under £650\" · \"Supreme Box Logo hoodie in stock in M\".",
    fields: [
      { name: "watch_what", label: "What to watch", placeholder: "…", required: true },
      { name: "interval_minutes", label: "Check every (min)", kind: "number", default: "60" },
    ],
  },
  {
    id: "photo_inbox",
    title: "Photo inbox",
    blurb: "Forward any photo on WhatsApp — receipts get filed, docs stored, cards captured.",
    example: "Forward a receipt → JARVIS extracts total + merchant + date and confirms.",
    fields: [],
  },
  {
    id: "group_chat_mode",
    title: "Group chat mode",
    blurb: "Anyone in a WhatsApp group can tag JARVIS and it'll do the task silently.",
    example: "\"JARVIS, book us a table at Dishoom for 8pm Friday\" — no chatbot noise.",
    fields: [
      { name: "keyword_contains", label: "Trigger word", placeholder: "jarvis", default: "jarvis" },
      { name: "from_contains", label: "Only from (optional)", placeholder: "+44…" },
    ],
  },
];

export function WatchersConsole() {
  const [watchers, setWatchers] = useState<WatcherRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/watchers/list", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "list failed");
      setWatchers(body.watchers as WatcherRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreated = useCallback(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: "24px 32px 40px", display: "flex", flexDirection: "column", gap: 32 }}>
      <SectionLabel>One-tap presets</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {PRESETS.map((p) => (
          <PresetCard key={p.id} preset={p} onCreated={onCreated} />
        ))}
      </div>

      <SectionLabel>Armed rules</SectionLabel>
      {error && <div style={{ color: "var(--magenta)", fontSize: 13 }}>{error}</div>}
      {!watchers && loading && <Muted>Loading…</Muted>}
      {watchers && watchers.length === 0 && (
        <Muted>Nothing armed yet. Pick a preset above, or ask JARVIS in chat.</Muted>
      )}
      {watchers && watchers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {watchers.map((w) => (
            <WatcherRowCard key={w.id} row={w} onChange={onCreated} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetCard({ preset, onCreated }: { preset: PresetDef; onCreated: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(preset.fields.map((f) => [f.name, f.default ?? ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  async function arm() {
    if (submitting) return;
    const missing = preset.fields.find((f) => f.required && !values[f.name]?.trim());
    if (missing) {
      setFlash(`${missing.label} is required`);
      return;
    }
    setSubmitting(true);
    setFlash(null);
    try {
      const payload: Record<string, unknown> = { preset: preset.id };
      for (const f of preset.fields) {
        const raw = values[f.name];
        if (!raw?.trim()) continue;
        if (f.kind === "number") {
          const n = Number(raw);
          if (Number.isFinite(n)) payload[f.name] = n;
        } else {
          payload[f.name] = raw.trim();
        }
      }
      const res = await fetch("/api/watchers/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "create failed");
      setFlash("Armed.");
      onCreated();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      setTimeout(() => setFlash(null), 2500);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "var(--surface)",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 18,
          color: "var(--ink)",
          letterSpacing: "-0.2px",
        }}
      >
        {preset.title}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{preset.blurb}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", fontStyle: "italic", lineHeight: 1.5 }}>
        {preset.example}
      </div>

      {preset.fields.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          {preset.fields.map((f) => (
            <label key={f.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "1.2px",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                {f.label}
              </span>
              <input
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                type={f.kind === "time" ? "time" : f.kind === "number" ? "number" : "text"}
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--rule)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                }}
              />
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <button
          onClick={arm}
          disabled={submitting}
          style={{
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            fontWeight: 500,
            color: "white",
            background: submitting ? "var(--ink-3)" : "var(--indigo)",
            border: "none",
            borderRadius: 8,
            padding: "7px 14px",
            cursor: submitting ? "default" : "pointer",
            letterSpacing: "-0.1px",
          }}
        >
          {submitting ? "Arming…" : "Arm"}
        </button>
        {flash && (
          <span style={{ fontSize: 12, color: flash === "Armed." ? "var(--indigo)" : "var(--magenta)" }}>
            {flash}
          </span>
        )}
      </div>
    </div>
  );
}

function WatcherRowCard({ row, onChange }: { row: WatcherRow; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function act(action: "enable" | "disable" | "delete") {
    setBusy(true);
    try {
      await fetch("/api/watchers/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, action }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 18px",
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        opacity: row.enabled ? 1 : 0.55,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.title}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginTop: 4,
            display: "flex",
            gap: 10,
          }}
        >
          <span>{row.trigger_kind}</span>
          {row.fire_count > 0 && <span>· fired {row.fire_count}×</span>}
          {row.last_fired_at && <span>· last {timeAgo(row.last_fired_at)}</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => act(row.enabled ? "disable" : "enable")}
          disabled={busy}
          style={chipBtn(row.enabled ? "var(--ink-2)" : "var(--indigo)")}
        >
          {row.enabled ? "Pause" : "Resume"}
        </button>
        <button onClick={() => act("delete")} disabled={busy} style={chipBtn("var(--magenta)")}>
          Delete
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        letterSpacing: "1.4px",
        textTransform: "uppercase",
        color: "var(--ink-3)",
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--sans)",
        fontSize: 13,
        color: "var(--ink-3)",
        padding: "6px 2px",
      }}
    >
      {children}
    </div>
  );
}

function chipBtn(color: string): React.CSSProperties {
  return {
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "1px",
    textTransform: "uppercase",
    color,
    background: "transparent",
    border: `1px solid ${color}`,
    borderRadius: 6,
    padding: "5px 9px",
    cursor: "pointer",
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "soon";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
