// Shared enqueue + trigger helper for every BackgroundAgent. This replaces
// the duplicated "insert into tasks + fire /api/tasks/run-* trigger" snippet
// that was pasted into every agent-silo file.

import type { ToolContext } from "../tools/types";
import type { BackgroundAgentConfig, BuildTaskRowResult } from "./types";
import type { z } from "zod";

function resolveBaseUrl(): string {
  return (
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030"
  );
}

export interface QueuedTask {
  task_id: string;
  status: "queued";
  title?: string;
  kind: string;
  message: string;
}

export async function enqueueTaskRow(
  ctx: ToolContext,
  row: BuildTaskRowResult,
): Promise<QueuedTask> {
  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      user_id: ctx.userId,
      kind: row.kind,
      prompt: row.prompt,
      args: row.args,
      device_target: row.deviceTarget ?? "server",
      status: "queued",
    })
    .select("id, created_at")
    .single();

  if (error) {
    throw new Error(`Failed to enqueue ${row.kind} task: ${error.message}`);
  }

  const baseUrl = resolveBaseUrl();
  void fetch(`${baseUrl}${row.runnerPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task_id: data.id }),
  }).catch((e) => {
    console.warn(`[async_agent:${row.kind}] trigger fetch failed:`, e);
  });

  return {
    task_id: data.id,
    status: "queued",
    title: row.title,
    kind: row.kind,
    message:
      row.okMessage ??
      `${row.kind} task queued and running in the background. Acknowledge briefly; I'll ping when it's ready.`,
  };
}

export async function runBackgroundAgent<S extends z.ZodTypeAny>(
  cfg: BackgroundAgentConfig<S>,
  input: unknown,
  ctx: ToolContext,
): Promise<QueuedTask> {
  const parsed = cfg.schema.parse(input) as z.infer<S>;
  const row = await cfg.buildTaskRow({ input: parsed, ctx });
  return enqueueTaskRow(ctx, row);
}
