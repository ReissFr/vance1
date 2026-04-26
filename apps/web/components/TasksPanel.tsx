"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cancelWorker, spawnWorkerForTask, subscribeToWorkerEvents } from "@/lib/worker";
import { isTauri } from "@/lib/tauri";

type WriterFormat = "email" | "linkedin_post" | "whatsapp_reply" | "tweet" | "cold_outreach" | "general";

type Task = {
  id: string;
  user_id: string;
  kind: string;
  status: "queued" | "running" | "needs_approval" | "done" | "failed" | "cancelled";
  prompt: string;
  args: {
    repo_path?: string;
    title?: string;
    format?: WriterFormat;
    recipient?: string;
  } | null;
  result: string | null;
  error: string | null;
  device_target: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  scheduled_at: string | null;
};

type TaskEvent = {
  id: string;
  task_id: string;
  kind: string;
  content: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

function statusColor(s: Task["status"]): string {
  switch (s) {
    case "queued":
      return "text-white/50";
    case "running":
      return "text-accent";
    case "done":
      return "text-green-400";
    case "failed":
      return "text-red-400";
    case "cancelled":
      return "text-white/40";
    case "needs_approval":
      return "text-yellow-400";
  }
}

function formatCost(n: number | null): string {
  if (n === null) return "";
  if (n < 0.01) return `$${(n * 100).toFixed(2)}¢`;
  return `$${n.toFixed(3)}`;
}

function isScheduled(t: Task): boolean {
  return (
    t.status === "queued" &&
    t.scheduled_at !== null &&
    new Date(t.scheduled_at).getTime() > Date.now()
  );
}

function formatScheduledAt(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `today ${time}`;
  const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr} ${time}`;
}

export function TasksPanel() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, TaskEvent[]>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const spawnedRef = useRef<Set<string>>(new Set());
  const supabaseRef = useRef(supabaseBrowser());

  // Resolve current user once.
  useEffect(() => {
    void supabaseRef.current.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, []);

  // Initial load + realtime subscription.
  useEffect(() => {
    if (!userId) return;
    const supabase = supabaseRef.current;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled && data) setTasks(data as Task[]);
    };
    void load();

    const channel = supabase
      .channel(`tasks:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled) return;
          setTasks((prev) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as Task, ...prev.filter((t) => t.id !== (payload.new as Task).id)];
            }
            if (payload.eventType === "UPDATE") {
              return prev.map((t) => (t.id === (payload.new as Task).id ? (payload.new as Task) : t));
            }
            if (payload.eventType === "DELETE") {
              return prev.filter((t) => t.id !== (payload.old as Task).id);
            }
            return prev;
          });
          // On new queued code_agent task, spawn the worker if we're in Tauri.
          if (
            payload.eventType === "INSERT" &&
            (payload.new as Task).status === "queued" &&
            (payload.new as Task).kind === "code_agent" &&
            (payload.new as Task).device_target === "local" &&
            isTauri() &&
            !spawnedRef.current.has((payload.new as Task).id)
          ) {
            console.log("[TasksPanel] realtime INSERT → spawning:", (payload.new as Task).id);
            spawnedRef.current.add((payload.new as Task).id);
            void spawnWorkerForTask(payload.new as Task).then((r) => {
              console.log("[TasksPanel] realtime spawn result:", (payload.new as Task).id, r);
              if (!r.ok) {
                void supabase
                  .from("tasks")
                  .update({
                    status: "failed",
                    error: `failed to spawn worker: ${r.error}`,
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", (payload.new as Task).id);
              }
            });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_events", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled) return;
          const e = payload.new as TaskEvent;
          setEvents((prev) => ({
            ...prev,
            [e.task_id]: [...(prev[e.task_id] ?? []), e].slice(-200),
          }));
        },
      )
      .subscribe();

    // Also pick up any queued tasks that were inserted before the subscription was ready
    // (e.g. brain called code_agent and Realtime hadn't latched yet).
    void (async () => {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "queued")
        .eq("kind", "code_agent");
      console.log("[TasksPanel] mount-fallback found queued tasks:", data?.length ?? 0, "isTauri:", isTauri());
      if (!data || !isTauri()) return;
      for (const t of data as Task[]) {
        if (spawnedRef.current.has(t.id)) continue;
        console.log("[TasksPanel] spawning worker for task:", t.id, t.args?.title);
        spawnedRef.current.add(t.id);
        void spawnWorkerForTask(t).then((r) => {
          console.log("[TasksPanel] spawn result for", t.id, ":", r);
          if (!r.ok) {
            void supabase
              .from("tasks")
              .update({
                status: "failed",
                error: `failed to spawn worker: ${r.error}`,
                completed_at: new Date().toISOString(),
              })
              .eq("id", t.id);
          }
        });
      }
    })();

    // Subscribe to Tauri worker:event / worker:exit once.
    let unlisten: (() => void) | null = null;
    void subscribeToWorkerEvents(userId).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      unlisten?.();
    };
  }, [userId]);

  // Load events for the currently expanded task.
  useEffect(() => {
    if (!expanded) return;
    const supabase = supabaseRef.current;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("task_events")
        .select("*")
        .eq("task_id", expanded)
        .order("created_at", { ascending: true })
        .limit(200);
      if (!cancelled && data) {
        setEvents((prev) => ({ ...prev, [expanded]: data as TaskEvent[] }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  const running = tasks.filter((t) => t.status === "running" || t.status === "queued").length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-white/60 hover:text-white/90 flex items-center gap-1"
        aria-label="Tasks"
      >
        <span>Tasks</span>
        {running > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-accent/20 text-accent text-[10px]">
            {running}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-7 w-[420px] max-h-[560px] overflow-y-auto bg-panel border border-white/10 rounded-lg shadow-xl z-50 p-3 text-sm">
          {tasks.length === 0 && (
            <div className="text-white/40 text-xs py-6 text-center">No tasks yet.</div>
          )}
          <div className="space-y-2">
            {tasks.map((t) => {
              const title = t.args?.title ?? t.prompt.slice(0, 60);
              const isExpanded = expanded === t.id;
              const evs = events[t.id] ?? [];
              return (
                <div key={t.id} className="border border-white/10 rounded p-2">
                  <button
                    className="w-full flex items-start justify-between gap-2 text-left"
                    onClick={() => setExpanded(isExpanded ? null : t.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-white/90 text-sm truncate">{title}</div>
                      <div className="text-[11px] text-white/40 truncate">
                        {t.kind} · {t.args?.repo_path ?? ""}
                        {isScheduled(t) && t.scheduled_at && (
                          <span className="text-white/50"> · ⏰ {formatScheduledAt(t.scheduled_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className={`text-xs ${statusColor(t.status)} whitespace-nowrap`}>
                      {isScheduled(t) ? "scheduled" : t.status}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
                      <div className="text-[11px] text-white/50 italic">
                        {t.prompt.length > 240 ? t.prompt.slice(0, 240) + "…" : t.prompt}
                      </div>
                      {evs.length > 0 && (
                        <div className="font-mono text-[11px] space-y-0.5 max-h-60 overflow-y-auto bg-black/20 rounded p-2">
                          {evs.map((e) => (
                            <EventLine key={e.id} ev={e} />
                          ))}
                        </div>
                      )}
                      {t.result && t.kind !== "outreach" && t.kind !== "inbox" && (
                        <div className="text-[11px] text-green-300/90 whitespace-pre-wrap border-l-2 border-green-500/40 pl-2">
                          {t.status === "needs_approval" || t.result.length <= 500
                            ? t.result
                            : t.result.slice(0, 500) + "…"}
                        </div>
                      )}
                      {t.kind === "writer" && t.status === "needs_approval" && t.result && (
                        <WriterApprovalBlock task={t} />
                      )}
                      {t.kind === "outreach" && t.result && (
                        <OutreachApprovalBlock task={t} />
                      )}
                      {t.kind === "inbox" && t.result && (
                        <InboxApprovalBlock task={t} />
                      )}
                      {t.error && (
                        <div className="text-[11px] text-red-300/90 whitespace-pre-wrap border-l-2 border-red-500/40 pl-2">
                          {t.error}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-white/40">
                        <span>
                          {t.input_tokens !== null && `${t.input_tokens} in / ${t.output_tokens ?? 0} out`}
                          {t.cost_usd !== null && ` · ${formatCost(t.cost_usd)}`}
                        </span>
                        {(t.status === "running" || t.status === "queued") && isTauri() && (
                          <button
                            className="text-red-300/80 hover:text-red-200"
                            onClick={() => void cancelWorker(t.id)}
                          >
                            cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WriterApprovalBlock({ task }: { task: Task }) {
  const format = task.args?.format ?? "general";
  const needsEmail = format === "email" || format === "cold_outreach";
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const approve = async () => {
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setMsg("Enter a valid email address.");
      return;
    }
    setBusy("approve");
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(needsEmail ? { to } : {}),
      });
      const j = await res.json();
      if (!j.ok) {
        setMsg(j.error ?? "Approve failed.");
        return;
      }
      if (j.action === "gmail_draft_created") {
        setMsg("Gmail draft created.");
        if (j.open_url) window.open(j.open_url, "_blank");
      } else if (j.action === "open_compose" && j.open_url) {
        window.open(j.open_url, "_blank");
      } else if (j.action === "copy" && j.text) {
        await navigator.clipboard.writeText(j.text);
        setMsg("Copied to clipboard.");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reject`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) setMsg(j.error ?? "Reject failed.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const approveLabel =
    format === "email" || format === "cold_outreach"
      ? "Create Gmail draft"
      : format === "linkedin_post"
        ? "Open LinkedIn compose"
        : format === "tweet"
          ? "Open X compose"
          : "Copy draft";

  return (
    <div className="mt-2 space-y-2 pt-2 border-t border-white/5">
      {needsEmail && (
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Recipient email"
          className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px] text-white/90 placeholder-white/30"
        />
      )}
      <div className="flex items-center gap-2">
        <button
          disabled={busy !== null}
          onClick={approve}
          className="text-[11px] px-2 py-1 rounded bg-green-500/20 text-green-200 hover:bg-green-500/30 disabled:opacity-50"
        >
          {busy === "approve" ? "..." : approveLabel}
        </button>
        <button
          disabled={busy !== null}
          onClick={reject}
          className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-200/80 hover:bg-red-500/20 disabled:opacity-50"
        >
          {busy === "reject" ? "..." : "Reject"}
        </button>
        {msg && <span className="text-[11px] text-white/60">{msg}</span>}
      </div>
    </div>
  );
}

type OutreachDraft = {
  prospect: { name: string; email: string; company?: string; role?: string; context?: string };
  subject: string;
  body: string;
  error?: string;
};
type OutreachStored = { campaign_goal: string; drafts: OutreachDraft[] };

function OutreachApprovalBlock({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  let parsed: OutreachStored | null = null;
  try {
    parsed = JSON.parse(task.result ?? "") as OutreachStored;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return (
      <div className="text-[11px] text-red-300/80 border-l-2 border-red-500/40 pl-2">
        Couldn't parse outreach drafts.
      </div>
    );
  }

  const canApprove = task.status === "needs_approval";

  const approveAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/approve`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) {
        setMsg(j.error ?? "Approve failed.");
        return;
      }
      setMsg(`Created ${j.created} Gmail drafts${j.failed ? ` (${j.failed} failed)` : ""}.`);
      if (j.open_url) window.open(j.open_url, "_blank");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reject`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) setMsg(j.error ?? "Reject failed.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 pt-2 border-t border-white/5">
      <div className="text-[11px] text-white/60">
        <span className="text-white/40">Campaign: </span>
        {parsed.campaign_goal.length > 140
          ? parsed.campaign_goal.slice(0, 140) + "…"
          : parsed.campaign_goal}
      </div>

      <div className="space-y-1">
        {parsed.drafts.map((d, i) => (
          <div key={i} className="border border-white/5 rounded">
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-center justify-between px-2 py-1 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-white/90 truncate">
                  {d.prospect.name}{" "}
                  <span className="text-white/40">&lt;{d.prospect.email}&gt;</span>
                </div>
                <div className="text-[10px] text-white/50 truncate">
                  {d.subject || "(no subject)"}
                </div>
              </div>
              {d.error && <span className="text-[10px] text-red-300/80 ml-2">err</span>}
            </button>
            {expanded === i && (
              <div className="px-2 pb-2 text-[11px] text-white/80 whitespace-pre-wrap border-t border-white/5 pt-2">
                <div className="font-medium text-white/60 mb-1">Subject: {d.subject}</div>
                {d.body}
                {d.error && (
                  <div className="mt-1 text-red-300/80 text-[10px]">⚠ {d.error}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {canApprove && (
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={approveAll}
            className="text-[11px] px-2 py-1 rounded bg-green-500/20 text-green-200 hover:bg-green-500/30 disabled:opacity-50"
          >
            {busy ? "..." : `Create ${parsed.drafts.length} Gmail drafts`}
          </button>
          <button
            disabled={busy}
            onClick={reject}
            className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-200/80 hover:bg-red-500/20 disabled:opacity-50"
          >
            Reject
          </button>
          {msg && <span className="text-[11px] text-white/60">{msg}</span>}
        </div>
      )}
      {!canApprove && msg && <span className="text-[11px] text-white/60">{msg}</span>}
    </div>
  );
}

type InboxEmail = {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  message_id_header: string;
  snippet: string;
  body: string;
};
type InboxEntry = {
  email: InboxEmail;
  classification: "needs_reply" | "fyi" | "newsletter" | "spam" | "action_required";
  priority: "high" | "medium" | "low";
  reason: string;
  suggested_reply?: { subject: string; body: string };
};
type InboxStored = { query: string; count: number; entries: InboxEntry[] };

function classBadge(c: InboxEntry["classification"]): { label: string; cls: string } {
  switch (c) {
    case "needs_reply":
      return { label: "reply", cls: "bg-yellow-500/20 text-yellow-200" };
    case "action_required":
      return { label: "action", cls: "bg-orange-500/20 text-orange-200" };
    case "fyi":
      return { label: "fyi", cls: "bg-white/10 text-white/60" };
    case "newsletter":
      return { label: "news", cls: "bg-blue-500/10 text-blue-200/70" };
    case "spam":
      return { label: "spam", cls: "bg-red-500/10 text-red-300/70" };
  }
}

function InboxApprovalBlock({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  let parsed: InboxStored | null = null;
  try {
    parsed = JSON.parse(task.result ?? "") as InboxStored;
  } catch {
    parsed = null;
  }

  // Default-select every entry with a suggested_reply on first render.
  useEffect(() => {
    if (initialized || !parsed) return;
    const withReplies = parsed.entries.filter((e) => e.suggested_reply).map((e) => e.email.id);
    setSelected(new Set(withReplies));
    setInitialized(true);
  }, [parsed, initialized]);

  if (!parsed) {
    return (
      <div className="text-[11px] text-red-300/80 border-l-2 border-red-500/40 pl-2">
        Couldn't parse inbox triage.
      </div>
    );
  }

  const canApprove = task.status === "needs_approval";
  const replyCandidates = parsed.entries.filter((e) => e.suggested_reply);

  if (parsed.entries.length === 0) {
    return (
      <div className="text-[11px] text-white/60 border-l-2 border-white/10 pl-2">
        No emails matched <span className="font-mono">{parsed.query}</span>. All clear.
      </div>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const approve = async () => {
    if (selected.size === 0) {
      setMsg("Select at least one reply to draft.");
      return;
    }
    setBusy("approve");
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email_ids: Array.from(selected) }),
      });
      const j = await res.json();
      if (!j.ok) {
        setMsg(j.error ?? "Approve failed.");
        return;
      }
      setMsg(`Created ${j.created} reply draft${j.created === 1 ? "" : "s"}${j.failed ? ` (${j.failed} failed)` : ""}.`);
      if (j.open_url) window.open(j.open_url, "_blank");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    setMsg(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reject`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) setMsg(j.error ?? "Reject failed.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2 pt-2 border-t border-white/5">
      <div className="text-[11px] text-white/60">
        <span className="text-white/40">Query: </span>
        <span className="font-mono">{parsed.query}</span> · {parsed.entries.length} emails ·{" "}
        {replyCandidates.length} reply draft{replyCandidates.length === 1 ? "" : "s"}
      </div>

      <div className="space-y-1">
        {parsed.entries.map((entry) => {
          const badge = classBadge(entry.classification);
          const isExpanded = expanded === entry.email.id;
          const hasReply = !!entry.suggested_reply;
          const isSelected = selected.has(entry.email.id);
          return (
            <div key={entry.email.id} className="border border-white/5 rounded">
              <div className="flex items-center gap-2 px-2 py-1">
                {hasReply && canApprove && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(entry.email.id)}
                    className="accent-accent shrink-0"
                  />
                )}
                <button
                  onClick={() => setExpanded(isExpanded ? null : entry.email.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] uppercase px-1 rounded ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="text-[11px] text-white/90 truncate flex-1">
                      {entry.email.from}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/50 truncate">
                    {entry.email.subject || "(no subject)"}
                  </div>
                </button>
              </div>
              {isExpanded && (
                <div className="px-2 pb-2 border-t border-white/5 pt-2 space-y-2">
                  <div className="text-[10px] text-white/50 italic">{entry.reason}</div>
                  <div className="text-[11px] text-white/70 whitespace-pre-wrap">
                    {entry.email.snippet ||
                      (entry.email.body.length > 300
                        ? entry.email.body.slice(0, 300) + "…"
                        : entry.email.body)}
                  </div>
                  {entry.suggested_reply && (
                    <div className="border-l-2 border-green-500/40 pl-2 text-[11px] text-green-200/90 whitespace-pre-wrap">
                      <div className="font-medium text-white/60 mb-1">
                        Draft reply — Subject: {entry.suggested_reply.subject}
                      </div>
                      {entry.suggested_reply.body}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canApprove && replyCandidates.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            disabled={busy !== null}
            onClick={approve}
            className="text-[11px] px-2 py-1 rounded bg-green-500/20 text-green-200 hover:bg-green-500/30 disabled:opacity-50"
          >
            {busy === "approve" ? "..." : `Create ${selected.size} reply draft${selected.size === 1 ? "" : "s"}`}
          </button>
          <button
            disabled={busy !== null}
            onClick={reject}
            className="text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-200/80 hover:bg-red-500/20 disabled:opacity-50"
          >
            Dismiss
          </button>
          {msg && <span className="text-[11px] text-white/60">{msg}</span>}
        </div>
      )}
      {canApprove && replyCandidates.length === 0 && (
        <div className="text-[11px] text-white/50">
          Nothing needs a reply. Dismiss when you're done reviewing.
        </div>
      )}
      {!canApprove && msg && <span className="text-[11px] text-white/60">{msg}</span>}
    </div>
  );
}

function EventLine({ ev }: { ev: TaskEvent }) {
  const prefix = (() => {
    switch (ev.kind) {
      case "tool_use":
        return "🔧";
      case "tool_result":
        return "←";
      case "text":
        return "💬";
      case "progress":
        return "⏳";
      case "thinking":
        return "🤔";
      case "error":
        return "✗";
      default:
        return "·";
    }
  })();
  const body =
    ev.kind === "tool_use" && ev.data && typeof ev.data.name === "string"
      ? `${ev.data.name}(${JSON.stringify(ev.data.input ?? {}).slice(0, 80)})`
      : ev.content ?? "";
  const cls = ev.kind === "error" ? "text-red-300" : ev.kind === "tool_use" ? "text-accent" : "text-white/70";
  return (
    <div className={cls}>
      <span className="text-white/40 mr-1">{prefix}</span>
      {body.length > 300 ? body.slice(0, 300) + "…" : body}
    </div>
  );
}
