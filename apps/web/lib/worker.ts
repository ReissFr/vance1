"use client";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { supabaseBrowser } from "@/lib/supabase/client";
import { runDeviceAction, tauriInvoke, isTauri } from "@/lib/tauri";

export type WorkerEventPayload = {
  task_id: string;
  line: string;
};

export type WorkerExitPayload = {
  task_id: string;
  code: number | null;
};

export type WorkerConfig = {
  worker_path: string;
  anthropic_api_key: string;
  default_repo: string;
};

type TaskRow = {
  id: string;
  kind: string;
  status: string;
  prompt: string;
  args: { repo_path?: string; title?: string } | null;
  device_target: string;
};

export async function getWorkerConfig(): Promise<WorkerConfig | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  try {
    return (await invoke("get_worker_config")) as WorkerConfig;
  } catch (e) {
    console.warn("[worker] get_worker_config failed:", e);
    return null;
  }
}

export async function spawnWorkerForTask(task: TaskRow): Promise<{ ok: boolean; error?: string }> {
  if (!isTauri()) return { ok: false, error: "not running in desktop app" };

  const cfg = await getWorkerConfig();
  if (!cfg) return { ok: false, error: "worker config missing" };

  const repo = task.args?.repo_path ?? cfg.default_repo;
  if (!repo) return { ok: false, error: "no repo path (set JARVIS_DEFAULT_REPO or include repo_path in args)" };

  const r = await runDeviceAction("spawn_worker", {
    taskId: task.id,
    prompt: task.prompt,
    repo,
    model: "claude-haiku-4-5-20251001",
    workerPath: cfg.worker_path,
    anthropicApiKey: cfg.anthropic_api_key,
  });
  if (!r.ok) return { ok: false, error: r.output };
  return { ok: true };
}

export async function cancelWorker(taskId: string): Promise<boolean> {
  const r = await runDeviceAction("cancel_worker", { taskId });
  return r.ok;
}

// Parse one JSONL line emitted by the worker and persist it as a task_event row.
// Also mutates the parent `tasks` row on result/error/boot transitions.
export async function handleWorkerLine(
  supabase: ReturnType<typeof supabaseBrowser>,
  userId: string,
  taskId: string,
  line: string,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    // Not JSON — log as a raw line so it's not lost.
    await supabase.from("task_events").insert({
      task_id: taskId,
      user_id: userId,
      kind: "log",
      content: trimmed.slice(0, 4000),
    });
    return;
  }

  const kind = typeof ev.kind === "string" ? ev.kind : "log";

  switch (kind) {
    case "boot": {
      await supabase
        .from("tasks")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", taskId);
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "log",
        content: `worker booted (model=${ev.model ?? "?"})`,
      });
      return;
    }

    case "system":
    case "thinking":
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind,
        content: typeof ev.content === "string" ? ev.content.slice(0, 4000) : null,
        data: (ev.data ?? null) as never,
      });
      return;

    case "text": {
      const content = typeof ev.content === "string" ? ev.content : "";
      if (!content.trim()) return;
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "text",
        content: content.slice(0, 4000),
      });
      return;
    }

    case "tool_use": {
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "tool_use",
        content: typeof ev.name === "string" ? ev.name : null,
        data: { id: ev.id, name: ev.name, input: ev.input } as never,
      });
      return;
    }

    case "tool_result": {
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "tool_result",
        content: typeof ev.content === "string" ? ev.content.slice(0, 4000) : null,
        data: { id: ev.id, is_error: ev.is_error } as never,
      });
      return;
    }

    case "progress": {
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "progress",
        content: typeof ev.tool === "string" ? `${ev.tool} (${ev.seconds ?? 0}s)` : null,
      });
      return;
    }

    case "result": {
      const ok = ev.ok === true;
      const usage = (ev.usage ?? {}) as {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
      await supabase
        .from("tasks")
        .update({
          status: ok ? "done" : "failed",
          result: typeof ev.result === "string" ? ev.result : null,
          error: ok ? null : typeof ev.error === "string" ? ev.error : "unknown error",
          input_tokens: usage.input_tokens ?? null,
          output_tokens: usage.output_tokens ?? null,
          cache_read_tokens: usage.cache_read_input_tokens ?? null,
          cost_usd: typeof ev.cost_usd === "number" ? ev.cost_usd : null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", taskId);
      return;
    }

    case "error": {
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "error",
        content: typeof ev.message === "string" ? ev.message.slice(0, 4000) : "unknown error",
      });
      return;
    }

    case "stderr": {
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "log",
        content: typeof ev.content === "string" ? `[stderr] ${ev.content}`.slice(0, 4000) : null,
      });
      return;
    }

    default: {
      await supabase.from("task_events").insert({
        task_id: taskId,
        user_id: userId,
        kind: "log",
        content: trimmed.slice(0, 4000),
      });
      return;
    }
  }
}

// Subscribe to Tauri worker events for the current session. Returns an unlisten fn.
export async function subscribeToWorkerEvents(
  userId: string,
  onEvent?: (taskId: string, line: string) => void,
  onExit?: (taskId: string, code: number | null) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const supabase = supabaseBrowser();

  const unlistenEvent: UnlistenFn = await listen<WorkerEventPayload>("worker:event", (e) => {
    void handleWorkerLine(supabase, userId, e.payload.task_id, e.payload.line);
    onEvent?.(e.payload.task_id, e.payload.line);
  });

  const unlistenExit: UnlistenFn = await listen<WorkerExitPayload>("worker:exit", async (e) => {
    // Only flip to failed if the task isn't already in a terminal state.
    const { data } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", e.payload.task_id)
      .single();
    if (data && (data.status === "running" || data.status === "queued")) {
      await supabase
        .from("tasks")
        .update({
          status: (e.payload.code ?? 1) === 0 ? "done" : "failed",
          error:
            (e.payload.code ?? 1) === 0
              ? null
              : `worker exited with code ${e.payload.code ?? "?"}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", e.payload.task_id);
    }
    onExit?.(e.payload.task_id, e.payload.code);
  });

  return () => {
    unlistenEvent();
    unlistenExit();
  };
}
