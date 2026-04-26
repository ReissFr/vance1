"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = {
  at: string;
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  error?: string;
  round?: number;
  reason?: string;
};

type Run = {
  id: string;
  goal: string;
  status: "queued" | "planning" | "running" | "cancelled" | "done" | "failed";
  steps: Step[];
  result: string | null;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

const ACTIVE_STATUSES = new Set(["queued", "planning", "running"]);

export function AutopilotConsole() {
  const [goal, setGoal] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [run?.steps.length]);

  useEffect(() => {
    if (!run?.id) return;
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`autopilot:${run.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "autopilot_runs", filter: `id=eq.${run.id}` },
        (payload) => {
          const next = payload.new as unknown as Run;
          setRun((prev) => (prev ? { ...prev, ...next } : next));
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [run?.id]);

  async function start() {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/autopilot/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "start failed");

      const sb = supabaseBrowser();
      const { data: row } = await sb
        .from("autopilot_runs")
        .select("*")
        .eq("id", data.id)
        .single();
      if (row) setRun(row as unknown as Run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!run) return;
    await fetch(`/api/autopilot/cancel/${run.id}`, { method: "POST" });
  }

  function reset() {
    setRun(null);
    setGoal("");
    setError(null);
  }

  const active = run ? ACTIVE_STATUSES.has(run.status) : false;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-white/60 hover:text-white/90 text-sm">← JARVIS</a>
          <h1 className="text-lg font-semibold text-orange-400">AUTOPILOT</h1>
        </div>
        {run && (
          <div className="flex items-center gap-3 text-xs text-white/50">
            <span>
              {run.input_tokens.toLocaleString()} in · {run.output_tokens.toLocaleString()} out
            </span>
            <StatusPill status={run.status} />
          </div>
        )}
      </header>

      {!run && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            <h2 className="text-3xl font-bold mb-2">Hand me the wheel.</h2>
            <p className="text-white/60 mb-6">
              Describe a goal. I&apos;ll take over every tool I have — email, browser, calendar,
              payments, research, concierge — and run until it&apos;s done. Watch live or walk away.
            </p>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Clear my inbox, book a flight to Lisbon this Friday, and prep a 3-bullet brief for tomorrow's 3pm meeting."
              rows={5}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-4 text-white placeholder-white/30 focus:outline-none focus:border-orange-500/60 resize-none"
            />
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={start}
                disabled={!goal.trim() || submitting}
                className="bg-orange-500 hover:bg-orange-400 disabled:bg-white/10 disabled:text-white/30 text-black font-semibold px-6 py-2 rounded-lg transition"
              >
                {submitting ? "starting…" : "engage"}
              </button>
            </div>
          </div>
        </div>
      )}

      {run && (
        <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto p-6 gap-4 overflow-hidden">
          <div className="border border-white/10 rounded-lg p-4 bg-white/5">
            <div className="text-xs uppercase tracking-wide text-white/40 mb-1">goal</div>
            <div className="text-sm">{run.goal}</div>
          </div>

          <div
            ref={feedRef}
            className="flex-1 border border-white/10 rounded-lg p-4 bg-black/40 overflow-y-auto font-mono text-xs space-y-2"
          >
            {run.steps.length === 0 && (
              <div className="text-white/40 italic">Planning…</div>
            )}
            {run.steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
          </div>

          {run.error && (
            <div className="border border-red-500/40 rounded-lg p-3 bg-red-500/10 text-red-300 text-sm">
              {run.error}
            </div>
          )}

          <div className="flex justify-between items-center">
            <div className="text-xs text-white/40">
              {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
            </div>
            <div className="flex gap-2">
              {active ? (
                <button
                  onClick={cancel}
                  className="text-xs px-4 py-2 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10"
                >
                  KILL
                </button>
              ) : (
                <button
                  onClick={reset}
                  className="text-xs px-4 py-2 rounded-lg border border-white/20 text-white/70 hover:bg-white/5"
                >
                  new goal
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Run["status"] }) {
  const colour =
    status === "done"
      ? "bg-green-500/20 text-green-300 border-green-500/30"
      : status === "failed"
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : status === "cancelled"
      ? "bg-white/10 text-white/60 border-white/20"
      : "bg-orange-500/20 text-orange-300 border-orange-500/30 animate-pulse";
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wide ${colour}`}>
      {status}
    </span>
  );
}

function StepRow({ step }: { step: Step }) {
  const time = step.at?.slice(11, 19) ?? "";
  if (step.type === "text") {
    return (
      <div className="text-white/90 whitespace-pre-wrap">
        <span className="text-white/30 mr-2">{time}</span>
        {step.text}
      </div>
    );
  }
  if (step.type === "tool_use") {
    return (
      <div className="text-cyan-300">
        <span className="text-white/30 mr-2">{time}</span>→ {step.name}
        <span className="text-white/50">({summariseInput(step.input)})</span>
      </div>
    );
  }
  if (step.type === "tool_result") {
    if (step.error) {
      return (
        <div className="text-red-300 pl-6">
          <span className="text-white/30 mr-2">{time}</span>✗ {String(step.error).slice(0, 200)}
        </div>
      );
    }
    return (
      <div className="text-green-300/80 pl-6">
        <span className="text-white/30 mr-2">{time}</span>✓ {summariseOutput(step.result)}
      </div>
    );
  }
  if (step.type === "cancelled") {
    return <div className="text-white/50 italic">cancelled at round {step.round}</div>;
  }
  if (step.type === "error") {
    return <div className="text-red-300">error: {step.error}</div>;
  }
  if (step.type === "model_fallback") {
    return <div className="text-yellow-300/70 italic">model fallback: {step.reason}</div>;
  }
  return null;
}

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  } catch {
    return "";
  }
}

function summariseOutput(r: unknown): string {
  if (r == null) return "done";
  if (typeof r === "string") return r.length > 160 ? r.slice(0, 160) + "…" : r;
  try {
    const s = JSON.stringify(r);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return "[result]";
  }
}
