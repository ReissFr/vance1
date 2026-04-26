// BackgroundAgent: the unified shape for every first-party "queue an async
// server-side task" capability (writer, outreach, inbox, research, ops, code,
// concierge). Each agent defines how its brain-facing tool looks and how to
// turn a parsed input into a row in the `tasks` table.
//
// The brain still sees discrete tools (one per agent) so the LLM UX is
// unchanged, but dispatch flows through a single registry — so adding a new
// agent is ~30 lines instead of a new silo.

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { ToolContext } from "../tools/types";

export interface BuildTaskRowArgs<Input> {
  input: Input;
  ctx: ToolContext;
}

export interface BuildTaskRowResult {
  // What goes into tasks.kind — the runner poller matches on this.
  kind: string;
  // tasks.prompt — the free-form brief the runner reads.
  prompt: string;
  // tasks.args — structured fields the runner needs.
  args: Record<string, unknown>;
  // Runner trigger path, e.g. "/api/tasks/run-writer". The helper fires a
  // fire-and-forget POST here after insert so the task starts immediately
  // instead of waiting for the next poll cycle.
  runnerPath: string;
  // tasks.device_target — almost always "server", but left configurable.
  deviceTarget?: "server" | "client";
  // Optional human-readable title surfaced in the Tasks panel.
  title?: string;
  // Optional: what the tool returns to the brain after queueing. Defaults to
  // a generic "queued" message; override for agent-specific framing.
  okMessage?: string;
}

export interface BackgroundAgentConfig<S extends z.ZodTypeAny> {
  // The name the brain sees (becomes the tool name). Must match the existing
  // tool name during migration so saved memory/logs/learnings stay valid.
  name: string;
  description: string;
  schema: S;
  inputSchema: Anthropic.Messages.Tool["input_schema"];
  // Turn parsed input into the row + runner path for enqueueing.
  buildTaskRow: (args: BuildTaskRowArgs<z.infer<S>>) => BuildTaskRowResult | Promise<BuildTaskRowResult>;
}

export interface BackgroundAgent {
  name: string;
  description: string;
  inputSchema: Anthropic.Messages.Tool["input_schema"];
  run: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}
