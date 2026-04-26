"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "./jarvis/primitives";
import { Chip } from "./jarvis/Chip";

type Section = "profile" | "voice" | "briefing" | "boundaries" | "devices" | "api";

const SECTIONS: { id: Section; label: string; meta?: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "voice", label: "Voice & tone" },
  { id: "briefing", label: "Schedules" },
  { id: "boundaries", label: "Boundaries", meta: "what JARVIS won't do" },
  { id: "devices", label: "Devices" },
  { id: "api", label: "API & keys" },
];

interface Profile {
  display_name: string | null;
  mobile_e164: string | null;
  voice_id: string | null;
  timezone: string | null;
  briefing_enabled: boolean;
  evening_wrap_enabled: boolean;
  weekly_review_enabled: boolean;
  proactive_enabled: boolean;
  proactive_snoozed_until: string | null;
  quiet_start_hour: number;
  quiet_end_hour: number;
  concierge_auto_limit_gbp: number | null;
  google_connected: boolean;
  onboarded_at: string | null;
  email: string | null;
}

const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

const VOICES = [
  { id: "alloy", label: "Alloy · neutral" },
  { id: "echo", label: "Echo · warm male" },
  { id: "fable", label: "Fable · british" },
  { id: "onyx", label: "Onyx · deep male" },
  { id: "nova", label: "Nova · bright female" },
  { id: "shimmer", label: "Shimmer · soft female" },
];

export function SettingsPanel({ email, name }: { email: string; name: string }) {
  const [section, setSection] = useState<Section>("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      const data = (await res.json()) as Profile;
      setProfile(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (body: Partial<Profile>) => {
      setFlashError(null);
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setFlashError(err.error ?? "save failed");
        return false;
      }
      setFlash("SAVED");
      setTimeout(() => setFlash(null), 1200);
      return true;
    },
    [],
  );

  const update = useCallback(
    async (patchBody: Partial<Profile>) => {
      if (!profile) return;
      const next = { ...profile, ...patchBody };
      setProfile(next);
      await patch(patchBody);
    },
    [profile, patch],
  );

  const runSchedule = useCallback(
    async (endpoint: string, label: string) => {
      setFlashError(null);
      setFlash(`STARTED · ${label}`);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setFlash(null);
          setFlashError(err.error ?? "run failed");
          return;
        }
        setTimeout(() => setFlash(null), 1800);
      } catch {
        setFlash(null);
        setFlashError("network error");
      }
    },
    [],
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gap: 32,
        padding: "28px 32px 48px",
        alignItems: "start",
      }}
    >
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              textAlign: "left",
              padding: "10px 14px",
              borderRadius: 8,
              background: section === s.id ? "var(--surface-2)" : "transparent",
              color: section === s.id ? "var(--ink)" : "var(--ink-2)",
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              fontWeight: section === s.id ? 500 : 400,
              border: "none",
              cursor: "pointer",
            }}
          >
            {s.label}
            {s.meta && (
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  marginTop: 2,
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                }}
              >
                {s.meta}
              </div>
            )}
          </button>
        ))}
      </nav>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {(flash || flashError) && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.6px",
              color: flashError ? "#F87171" : "var(--indigo)",
              padding: "6px 10px",
              border: `1px solid ${flashError ? "#F87171" : "var(--indigo)"}`,
              borderRadius: 6,
              alignSelf: "flex-end",
            }}
          >
            {flashError ?? flash}
          </div>
        )}

        {loading || !profile ? (
          <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {section === "profile" && (
              <>
                <EditableField
                  label="Preferred name"
                  value={profile.display_name ?? name ?? ""}
                  placeholder="Reiss"
                  onCommit={(v) => update({ display_name: v || null })}
                />
                <ReadonlyField label="Email" value={email || profile.email || "—"} />
                <EditableField
                  label="Mobile (E.164)"
                  value={profile.mobile_e164 ?? ""}
                  placeholder="+447700900000"
                  onCommit={(v) => update({ mobile_e164: v || null })}
                />
                <SelectField
                  label="Timezone"
                  value={profile.timezone ?? "Europe/London"}
                  options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                  onChange={(v) => update({ timezone: v })}
                />
              </>
            )}

            {section === "voice" && (
              <>
                <SelectField
                  label="Default voice"
                  value={profile.voice_id ?? "alloy"}
                  options={VOICES.map((v) => ({ value: v.id, label: v.label }))}
                  onChange={(v) => update({ voice_id: v })}
                />
                <ReadonlyField
                  label="Tone"
                  value="Calm · concise · never performative"
                />
              </>
            )}

            {section === "briefing" && (
              <>
                <ToggleRow
                  label="Daily morning briefing"
                  description="07:00 WhatsApp: revenue, spend, calendar, emails, birthdays, weather."
                  checked={profile.briefing_enabled}
                  onChange={(v) => update({ briefing_enabled: v })}
                  onRun={() => runSchedule("/api/briefing/run", "Morning briefing")}
                />
                <ToggleRow
                  label="Evening wrap-up"
                  description="22:00 recap: what you got done, what's open, what fires tomorrow."
                  checked={profile.evening_wrap_enabled}
                  onChange={(v) => update({ evening_wrap_enabled: v })}
                  onRun={() => runSchedule("/api/evening-wrap/run", "Evening wrap")}
                />
                <ToggleRow
                  label="Weekly review"
                  description="Sunday 18:00: the week's pattern, standouts, what to kill."
                  checked={profile.weekly_review_enabled}
                  onChange={(v) => update({ weekly_review_enabled: v })}
                  onRun={() => runSchedule("/api/weekly-review/run", "Weekly review")}
                />
                <ToggleRow
                  label="Proactive nudges"
                  description="JARVIS pings you when a signal crosses a threshold — never on a schedule."
                  checked={profile.proactive_enabled}
                  onChange={(v) => update({ proactive_enabled: v })}
                />
                <SnoozeRow
                  until={profile.proactive_snoozed_until}
                  onSnooze={(iso) => update({ proactive_snoozed_until: iso })}
                />
                <QuietHoursRow
                  startHour={profile.quiet_start_hour}
                  endHour={profile.quiet_end_hour}
                  onChange={(start, end) =>
                    update({ quiet_start_hour: start, quiet_end_hour: end })
                  }
                />
                <NumberField
                  label="Concierge auto-limit (£)"
                  value={profile.concierge_auto_limit_gbp}
                  placeholder="50"
                  onCommit={(v) => update({ concierge_auto_limit_gbp: v })}
                  hint="Auto-approve bookings under this amount. Leave blank to always ask."
                />
              </>
            )}

            {section === "boundaries" && (
              <Card padding="22px 24px">
                <div
                  style={{
                    fontFamily: "var(--serif)",
                    fontStyle: "italic",
                    fontSize: 20,
                    color: "var(--ink)",
                    letterSpacing: "-0.2px",
                    marginBottom: 14,
                  }}
                >
                  I never do these without asking.
                </div>
                {[
                  "Send anything — email, WhatsApp, iMessage, Slack",
                  "Book something that costs money",
                  "Commit code to the main branch",
                  "Share contact details with anyone new",
                  "Respond to family/close contacts in your voice",
                ].map((b, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom:
                        i === 4 ? "none" : "1px solid var(--rule-soft)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--indigo)",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--sans)",
                        fontSize: 13.5,
                        color: "var(--ink-2)",
                        flex: 1,
                      }}
                    >
                      {b}
                    </span>
                    <Chip color="var(--ink-3)" size={9.5}>
                      ALWAYS ASK
                    </Chip>
                  </div>
                ))}
              </Card>
            )}

            {section === "devices" && (
              <>
                <ReadonlyField
                  label="Mac"
                  value="MacBook Pro · pair via Tauri app"
                />
                <ReadonlyField
                  label="iPhone"
                  value="iPhone · pair via native app"
                />
                <ReadonlyField label="Web" value="This session · browser" />
                <ReadonlyField label="Cloud" value="Supabase · healthy" />
                <ReadonlyField
                  label="Onboarded"
                  value={
                    profile.onboarded_at
                      ? new Date(profile.onboarded_at).toLocaleDateString("en-GB")
                      : "not yet"
                  }
                />
              </>
            )}

            {section === "api" && (
              <>
                <ReadonlyField
                  label="Anthropic"
                  value="Managed server-side · set via env"
                />
                <ReadonlyField
                  label="Google OAuth"
                  value={
                    profile.google_connected
                      ? "Connected — refresh token fresh"
                      : "Not connected"
                  }
                />
                <ReadonlyField
                  label="Other providers"
                  value="Connect in /integrations"
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Row label={label}>
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onCommit(local.trim());
        }}
        placeholder={placeholder}
        style={inputStyle}
      />
    </Row>
  );
}

function SnoozeRow({
  until,
  onSnooze,
}: {
  until: string | null;
  onSnooze: (iso: string | null) => void;
}) {
  const now = Date.now();
  const untilMs = until ? new Date(until).getTime() : 0;
  const active = untilMs > now;
  const remainingMin = active ? Math.round((untilMs - now) / 60000) : 0;
  const remainingLabel = active
    ? remainingMin >= 60
      ? `${(remainingMin / 60).toFixed(remainingMin >= 180 ? 0 : 1)}h left`
      : `${remainingMin}m left`
    : "not snoozed";

  function pickFuture(ms: number) {
    onSnooze(new Date(Date.now() + ms).toISOString());
  }
  function untilTomorrow8am() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    onSnooze(d.toISOString());
  }

  return (
    <Card padding="18px 22px">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 16,
              color: "var(--ink)",
            }}
          >
            Mute proactive nudges
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: active ? "#FBBF24" : "var(--ink-3)",
              marginTop: 4,
              letterSpacing: "0.3px",
            }}
          >
            {active
              ? `SNOOZED · ${remainingLabel} · until ${new Date(untilMs).toLocaleString()}`
              : "Temporary pause — in a meeting, on vacation, in flow state."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <SnoozeBtn label="1h" onClick={() => pickFuture(60 * 60 * 1000)} />
          <SnoozeBtn label="3h" onClick={() => pickFuture(3 * 60 * 60 * 1000)} />
          <SnoozeBtn label="Until 8am" onClick={untilTomorrow8am} />
          {active && <SnoozeBtn label="Clear" onClick={() => onSnooze(null)} danger />}
        </div>
      </div>
    </Card>
  );
}

function SnoozeBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        padding: "6px 10px",
        background: "transparent",
        color: danger ? "#ff6b6b" : "var(--indigo)",
        border: `1px solid ${danger ? "#ff6b6b" : "var(--indigo)"}`,
        borderRadius: 6,
        cursor: "pointer",
        letterSpacing: "0.4px",
      }}
    >
      {label}
    </button>
  );
}

function QuietHoursRow({
  startHour,
  endHour,
  onChange,
}: {
  startHour: number;
  endHour: number;
  onChange: (start: number, end: number) => void;
}) {
  const disabled = startHour === endHour;
  const summary = disabled
    ? "ALWAYS OPEN · proactive may ping any hour"
    : `${formatHour(startHour)} → ${formatHour(endHour)} · proactive muted`;

  return (
    <Card padding="18px 22px">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 16,
              color: "var(--ink)",
            }}
          >
            Quiet hours
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 4,
              letterSpacing: "0.3px",
            }}
          >
            {summary}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <HourSelect value={startHour} onChange={(v) => onChange(v, endHour)} />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            →
          </span>
          <HourSelect value={endHour} onChange={(v) => onChange(startHour, v)} />
        </div>
      </div>
    </Card>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 12,
        padding: "6px 10px",
        background: "transparent",
        color: "var(--ink)",
        border: "1px solid var(--rule)",
        borderRadius: 6,
        cursor: "pointer",
        letterSpacing: "0.3px",
      }}
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {formatHour(h)}
        </option>
      ))}
    </select>
  );
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function NumberField({
  label,
  value,
  placeholder,
  onCommit,
  hint,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  onCommit: (v: number | null) => void;
  hint?: string;
}) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  useEffect(() => setLocal(value == null ? "" : String(value)), [value]);
  return (
    <Row label={label} hint={hint}>
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => {
          const next = local === "" ? null : Number(local);
          const current = value == null ? null : Number(value);
          if (next !== current) onCommit(next);
        }}
        placeholder={placeholder}
        inputMode="decimal"
        style={inputStyle}
      />
    </Row>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <Row label={label}>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          color: "var(--ink-3)",
          padding: "9px 0",
        }}
      >
        {value}
      </div>
    </Row>
  );
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 20,
        padding: "14px 18px",
        borderBottom: "1px solid var(--rule-soft)",
        alignItems: "center",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "1.4px",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        {hint && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 11,
              color: "var(--ink-4)",
              marginTop: 4,
              lineHeight: 1.4,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  onRun,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onRun?: () => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "16px 18px",
        borderBottom: "1px solid var(--rule-soft)",
        cursor: "pointer",
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink)",
            fontWeight: 500,
            marginBottom: 2,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        )}
      </div>
      {onRun && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.8px",
            padding: "5px 9px",
            background: "transparent",
            color: "var(--indigo)",
            border: "1px solid var(--indigo)",
            borderRadius: 6,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          RUN NOW
        </button>
      )}
      <div
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--indigo)" : "var(--surface-2)",
          border: "1px solid var(--rule)",
          position: "relative",
          flexShrink: 0,
          transition: "background 200ms",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 200ms",
          }}
        />
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 360,
  padding: "9px 12px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--rule)",
  color: "var(--ink)",
  fontFamily: "var(--sans)",
  fontSize: 13,
  outline: "none",
};
