"use client";

// MorningBriefingConsole: real morning-briefing surface. Polls /api/briefing/latest
// and renders whatever the briefing runner wrote. The briefing is plain text
// with ALL-CAPS section headers + "• " bullet lines — we parse that into
// typeset sections instead of dumping it as a blob.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/jarvis/primitives";

type LatestResponse = {
  ok: true;
  briefing_enabled: boolean;
  display_name: string | null;
  task: {
    id: string;
    status: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
    title: string;
  } | null;
  briefing: string | null;
};

type ArchiveItem = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  title: string;
};

type TaskDetail = {
  id: string;
  status: string;
  error: string | null;
  result: string | null;
  created_at: string;
  completed_at: string | null;
  args: { title?: string } | null;
};

type Section = {
  title: string;
  lines: string[];
};

type Parsed = {
  greeting: string | null;
  sections: Section[];
  closing: string | null;
};

const HEADER_RE = /^[A-Z][A-Z0-9 &/]{2,}$/;

function parseBriefing(text: string): Parsed {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let greeting: string | null = null;
  const sections: Section[] = [];
  let current: Section | null = null;
  const tail: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^([A-Z][A-Z0-9 &/]{2,}):?\s*(.*)$/);
    const headerTitle = headerMatch?.[1];
    if (headerMatch && headerTitle && HEADER_RE.test(headerTitle)) {
      const rest = headerMatch[2] ?? "";
      current = { title: headerTitle, lines: [] };
      if (rest) current.lines.push(rest);
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line.replace(/^[•\-*]\s*/, ""));
    } else if (!greeting) {
      greeting = line;
    } else {
      tail.push(line);
    }
  }

  const closing = sections.length > 0 && tail.length > 0 ? tail.join(" ") : null;
  if (sections.length === 0 && tail.length > 0 && greeting) {
    return { greeting, sections: [], closing: tail.join(" ") };
  }
  return { greeting, sections, closing };
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MorningBriefingConsole() {
  const [data, setData] = useState<LatestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/briefing/latest", { cache: "no-store" });
      const body = (await res.json()) as LatestResponse;
      if (!res.ok) throw new Error("load failed");
      setData(body);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadArchive = useCallback(async () => {
    try {
      const res = await fetch("/api/briefing/history?limit=14", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { ok: boolean; briefings: ArchiveItem[] };
      if (body.ok) setArchive(body.briefings ?? []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadArchive();
    const id = setInterval(() => {
      void load();
      void loadArchive();
    }, 8000);
    return () => clearInterval(id);
  }, [load, loadArchive]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTask(null);
      return;
    }
    fetch(`/api/tasks/${selectedId}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ task?: TaskDetail }>) : null))
      .then((body) => setSelectedTask(body?.task ?? null))
      .catch(() => setSelectedTask(null));
  }, [selectedId]);

  const runBriefing = useCallback(async () => {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/briefing/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "run failed");
      setFlash("briefing started");
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (!data) {
    return <Center>loading…</Center>;
  }

  const viewingArchive = Boolean(selectedId);
  const task = viewingArchive
    ? selectedTask
      ? {
          id: selectedTask.id,
          status: selectedTask.status,
          error: selectedTask.error,
          created_at: selectedTask.created_at,
          completed_at: selectedTask.completed_at,
          title: selectedTask.args?.title ?? "Morning briefing",
        }
      : null
    : data.task;
  const briefing = viewingArchive ? (selectedTask?.result ?? null) : data.briefing;
  const running = !viewingArchive && task && (task.status === "queued" || task.status === "running");
  const parsed = briefing ? parseBriefing(briefing) : null;
  const name = data.display_name ?? "Reiss";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "28px 32px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <TopBar
        task={task}
        today={today}
        busy={busy}
        onRun={runBriefing}
        flash={flash}
      />

      {archive.length > 1 && (
        <ArchiveStrip
          archive={archive}
          selectedId={selectedId}
          latestId={data.task?.id ?? null}
          onPick={setSelectedId}
        />
      )}

      {!task && !running && (
        <EmptyState name={name} onRun={runBriefing} busy={busy} />
      )}

      {running && <RunningState />}

      {!running && task?.status === "failed" && (
        <Card padding="22px 24px">
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--magenta)",
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Briefing failed
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {task.error ?? "unknown error"}
          </div>
        </Card>
      )}

      {!running && parsed && (
        <>
          {parsed.greeting && (
            <div
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 34,
                color: "var(--ink)",
                letterSpacing: "-0.6px",
                lineHeight: 1.2,
              }}
            >
              {parsed.greeting}
            </div>
          )}

          {parsed.sections.map((s) => (
            <BriefBlock key={s.title} title={s.title} lines={s.lines} />
          ))}

          {parsed.closing && (
            <Card padding="22px 24px">
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  letterSpacing: "1.4px",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                One more thing
              </div>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontStyle: "italic",
                  fontSize: 21,
                  color: "var(--ink-2)",
                  lineHeight: 1.4,
                  letterSpacing: "-0.2px",
                }}
              >
                {parsed.closing}
              </div>
            </Card>
          )}
        </>
      )}

      {!data.briefing_enabled && (
        <Card padding="16px 20px" style={{ borderStyle: "dashed" }}>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            Daily 07:00 briefing is off.{" "}
            <Link href="/settings" style={{ color: "var(--indigo)" }}>
              Enable it in settings
            </Link>{" "}
            to get this in WhatsApp every morning.
          </div>
        </Card>
      )}
    </div>
  );
}

function TopBar({
  task,
  today,
  busy,
  onRun,
  flash,
}: {
  task: LatestResponse["task"];
  today: string;
  busy: boolean;
  onRun: () => void;
  flash: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "1.6px",
          textTransform: "uppercase",
        }}
      >
        {today}
        {task ? ` · last run ${formatWhen(task.completed_at ?? task.created_at)}` : " · never run"}
        {task ? ` · ${task.status}` : ""}
      </div>
      <div style={{ flex: 1 }} />
      {flash && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "0.6px",
          }}
        >
          {flash}
        </span>
      )}
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid var(--rule)",
          background: busy ? "var(--surface-2)" : "var(--surface)",
          color: "var(--ink)",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "running…" : "Run briefing now"}
      </button>
    </div>
  );
}

function BriefBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "1.6px",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 20,
          color: "var(--ink)",
          lineHeight: 1.5,
          letterSpacing: "-0.1px",
          fontWeight: 400,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  name,
  onRun,
  busy,
}: {
  name: string;
  onRun: () => void;
  busy: boolean;
}) {
  return (
    <Card padding="44px 40px" style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 28,
          color: "var(--ink)",
          letterSpacing: "-0.4px",
          marginBottom: 10,
        }}
      >
        No briefing yet, {name}.
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 14,
          color: "var(--ink-2)",
          lineHeight: 1.5,
          marginBottom: 22,
        }}
      >
        I pull revenue, spend, calendar, unread email, birthdays and weather,
        then write a short WhatsApp-shaped brief. Run it now or wait for 07:00.
      </div>
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          padding: "12px 22px",
          borderRadius: 8,
          border: "1px solid var(--indigo)",
          background: "var(--indigo)",
          color: "white",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "starting…" : "Run briefing now"}
      </button>
    </Card>
  );
}

function RunningState() {
  return (
    <Card padding="28px 32px" style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--indigo)",
          letterSpacing: "1.6px",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Gathering
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 19,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        Pulling revenue, calendar and email. This usually takes 10–30 seconds.
      </div>
    </Card>
  );
}

function ArchiveStrip({
  archive,
  selectedId,
  latestId,
  onPick,
}: {
  archive: ArchiveItem[];
  selectedId: string | null;
  latestId: string | null;
  onPick: (id: string | null) => void;
}) {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const yday = new Date(today);
    yday.setDate(yday.getDate() - 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(d, today)) return "TODAY";
    if (sameDay(d, yday)) return "YESTERDAY";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
        padding: "10px 0",
        borderTop: "1px solid var(--rule)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          marginRight: 4,
        }}
      >
        Archive
      </span>
      <Pill
        label="LATEST"
        active={selectedId === null}
        onClick={() => onPick(null)}
      />
      {archive
        .filter((a) => a.id !== latestId)
        .map((a) => (
          <Pill
            key={a.id}
            label={fmt(a.created_at)}
            active={selectedId === a.id}
            onClick={() => onPick(a.id)}
            failed={a.status === "failed"}
          />
        ))}
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
  failed,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  failed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10,
        padding: "5px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--indigo)" : "var(--rule)"}`,
        background: active ? "var(--indigo-soft)" : "transparent",
        color: failed ? "var(--magenta)" : active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
        letterSpacing: "0.6px",
      }}
    >
      {label}
      {failed && " ·!"}
    </button>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 20px",
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--ink-3)",
        letterSpacing: "1.4px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}
