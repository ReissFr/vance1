"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/jarvis/primitives";

type LatestResponse = {
  ok: true;
  enabled: boolean;
  display_name: string | null;
  task: {
    id: string;
    status: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
    title: string;
  } | null;
  text: string | null;
};

type Props = {
  latestEndpoint: string;
  runEndpoint: string;
  historyEndpoint?: string;
  kindLabel: string;
  scheduleHint: string;
  enabledToggleKey: "evening_wrap_enabled" | "weekly_review_enabled";
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
  kind: string;
  status: string;
  result: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

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

const HEADER_RE = /^[A-Z][A-Z0-9 &/]{2,}:?\s*(.*)$/;

function renderTextBlocks(text: string): { headers: { title: string; lines: string[] }[]; greeting: string | null; closing: string | null } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let greeting: string | null = null;
  const headers: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const tail: string[] = [];
  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m && /^[A-Z][A-Z0-9 &/]{2,}$/.test(m[1] ?? line)) {
      const title = (line.match(/^([A-Z][A-Z0-9 &/]{2,}):?/)?.[1] ?? line).trim();
      current = { title, lines: [] };
      const rest = line.replace(/^[A-Z][A-Z0-9 &/]{2,}:?\s*/, "");
      if (rest) current.lines.push(rest);
      headers.push(current);
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
  const closing = headers.length > 0 && tail.length > 0 ? tail.join(" ") : null;
  return { headers, greeting, closing };
}

export function DigestView({
  latestEndpoint,
  runEndpoint,
  historyEndpoint,
  kindLabel,
  scheduleHint,
  enabledToggleKey,
}: Props) {
  const [data, setData] = useState<LatestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(latestEndpoint, { cache: "no-store" });
      const body = (await res.json()) as LatestResponse;
      if (!res.ok) throw new Error("load failed");
      setData(body);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    }
  }, [latestEndpoint]);

  const loadArchive = useCallback(async () => {
    if (!historyEndpoint) return;
    try {
      const res = await fetch(historyEndpoint, { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; digests?: ArchiveItem[] };
      if (!res.ok || !body.ok) return;
      setArchive(body.digests ?? []);
    } catch {
      // swallow — archive strip degrades gracefully
    }
  }, [historyEndpoint]);

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
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tasks/${selectedId}`, { cache: "no-store" });
        const body = (await res.json()) as { ok: boolean; task?: TaskDetail };
        if (!cancelled && res.ok && body.ok && body.task) {
          setSelectedTask(body.task);
        }
      } catch {
        // swallow
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const run = useCallback(async () => {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(runEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "run failed");
      setFlash(`${kindLabel} started`);
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load, runEndpoint, kindLabel]);

  if (!data) {
    return (
      <div style={{ padding: "28px 32px", color: "var(--ink-3)", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  const viewingArchive = Boolean(selectedId);
  const sourceTask = viewingArchive
    ? selectedTask
      ? {
          id: selectedTask.id,
          status: selectedTask.status,
          error: selectedTask.error,
          created_at: selectedTask.created_at,
          completed_at: selectedTask.completed_at,
          title: kindLabel,
        }
      : null
    : data.task;
  const sourceText = viewingArchive ? selectedTask?.result ?? null : data.text;
  const task = sourceTask;
  const text = sourceText;
  const running = !viewingArchive && task && (task.status === "queued" || task.status === "running");
  const parsed = text ? renderTextBlocks(text) : null;
  const enabledNote = data.enabled
    ? `${scheduleHint} · auto-sent to WhatsApp`
    : `Scheduled delivery is off — turn on in /settings (${enabledToggleKey.replace("_enabled", "")})`;

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "28px 32px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Last run · {task ? formatWhen(task.completed_at ?? task.created_at) : "never"}
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {enabledNote}
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy || Boolean(running) || viewingArchive}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "9px 16px",
            background: "var(--indigo-soft)",
            color: "var(--ink)",
            border: "1px solid var(--indigo)",
            borderRadius: 8,
            cursor: busy || running ? "wait" : "pointer",
            letterSpacing: "0.6px",
            opacity: viewingArchive ? 0.4 : 1,
          }}
        >
          {busy || running ? "RUNNING…" : "RUN NOW"}
        </button>
      </div>

      {archive.length > 0 && (
        <ArchiveStrip
          archive={archive}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {flash && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--indigo)",
            padding: "8px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--surface)",
            letterSpacing: "0.4px",
          }}
        >
          {flash}
        </div>
      )}

      {running && (
        <Card padding="22px 24px">
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--indigo)",
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Working on it
          </div>
          <div style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--ink-2)" }}>
            Collecting signals and drafting your {kindLabel.toLowerCase()}…
          </div>
        </Card>
      )}

      {!running && task?.status === "failed" && (
        <Card padding="22px 24px">
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--magenta)",
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {kindLabel} failed
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {task.error ?? "Unknown error."}
          </div>
        </Card>
      )}

      {parsed && !running && (
        <Card padding="26px 28px">
          {parsed.greeting && (
            <div
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 22,
                color: "var(--ink)",
                marginBottom: 18,
                letterSpacing: "-0.2px",
              }}
            >
              {parsed.greeting}
            </div>
          )}
          {parsed.headers.map((h, i) => (
            <div key={i} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: "1.6px",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {h.title}
              </div>
              {h.lines.map((line, j) => (
                <div
                  key={j}
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 14,
                    color: "var(--ink-2)",
                    lineHeight: 1.55,
                    paddingLeft: 2,
                    marginBottom: 4,
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          ))}
          {parsed.closing && (
            <div
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 15,
                color: "var(--ink-3)",
                marginTop: 10,
              }}
            >
              {parsed.closing}
            </div>
          )}
        </Card>
      )}

      {!parsed && !running && (
        <Card padding="32px 28px">
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 22,
              color: "var(--ink-2)",
              marginBottom: 12,
            }}
          >
            No {kindLabel.toLowerCase()} yet.
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            Hit RUN NOW to produce one on demand.
          </div>
        </Card>
      )}
    </div>
  );
}

function ArchivePill({
  label,
  active,
  failed,
  onClick,
}: {
  label: string;
  active: boolean;
  failed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        padding: "6px 10px",
        background: active ? "var(--indigo-soft)" : "transparent",
        color: failed ? "var(--magenta)" : active ? "var(--ink)" : "var(--ink-3)",
        border: `1px solid ${active ? "var(--indigo)" : "var(--rule)"}`,
        borderRadius: 6,
        cursor: "pointer",
        letterSpacing: "0.6px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function archivePillLabel(at: string): string {
  const d = new Date(at);
  const now = new Date();
  const ymd = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const today = ymd(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (ymd(d) === today) return "TODAY";
  if (ymd(d) === ymd(yesterday)) return "YESTERDAY";
  return d
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
    .toUpperCase();
}

function ArchiveStrip({
  archive,
  selectedId,
  onSelect,
}: {
  archive: ArchiveItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "10px 12px",
        border: "1px solid var(--rule)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
    >
      <ArchivePill
        label="LATEST"
        active={selectedId === null}
        failed={false}
        onClick={() => onSelect(null)}
      />
      {archive.map((a) => {
        const failed = a.status === "failed";
        return (
          <ArchivePill
            key={a.id}
            label={`${archivePillLabel(a.completed_at ?? a.created_at)}${failed ? " ·!" : ""}`}
            active={selectedId === a.id}
            failed={failed}
            onClick={() => onSelect(a.id)}
          />
        );
      })}
    </div>
  );
}
