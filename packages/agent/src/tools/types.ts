import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

export interface QueueClientActionArgs {
  toolName: string;
  toolArgs: unknown;
}

export type BrowserAction =
  | { type: "open"; url: string }
  | { type: "screenshot" }
  | { type: "click"; target: string; nth?: number }
  | { type: "click_id"; id: number }
  | { type: "click_xy"; x: number; y: number }
  | { type: "type"; text: string; submit?: boolean }
  | { type: "type_in"; id: number; text: string; submit?: boolean }
  | { type: "press"; key: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "read" }
  | { type: "status" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "wait"; seconds: number }
  | { type: "close" };

export interface BrowserResult {
  ok: boolean;
  output?: string;
  imageB64?: string;
  url?: string;
  title?: string;
  // Present on { type: "status" } results — whether a visible password input
  // is on the current page. Used by pre-sign-in polling (/sites) to detect
  // when the user has finished authenticating.
  hasPasswordInput?: boolean;
}

export interface ToolContext {
  userId: string;
  supabase: SupabaseClient;
  googleAccessToken?: string;
  embed: (text: string) => Promise<number[]>;
  // Optional: send a queued notification row via whatever delivery infra the
  // host has wired up (currently Twilio). The tool inserts the row, the host
  // handles the REST call + sid/status update.
  dispatchNotification?: (notificationId: string) => Promise<void>;
  // Optional: queue a client-side action (Mac tool) for async execution by the
  // user's desktop app. Present when the brain runs in a non-interactive
  // context (e.g. WhatsApp inbound). When absent, Mac tools fall back to their
  // legacy behaviour of returning expects_followup for the live client to
  // handle. Returns the queued row id so the tool can surface it.
  queueClientAction?: (args: QueueClientActionArgs) => Promise<{ id: string }>;
  // Optional: drive a Playwright browser. Provided by the host (Next.js API
  // routes) so the brain can navigate, click, type, screenshot, and read
  // pages. Much more reliable than OS-level computer use.
  executeBrowserAction?: (action: BrowserAction) => Promise<BrowserResult>;
  // Optional: load a skill body on demand (agentskills.io spec). The host
  // wires this to the skills directory; the load_skill tool uses it.
  loadSkillBody?: (name: string) => Promise<{ name: string; description: string; body: string } | null>;
  // Optional: install a skill from a remote source (GitHub repo/subfolder or
  // raw SKILL.md URL). Wired by the host against its skills directory.
  installSkill?: (source: string) => Promise<{ name: string; dir: string; files: number }>;
  // Optional: preview a skill without writing anything. Used so the brain can
  // show the user what it's about to install before getting consent.
  previewSkill?: (source: string) => Promise<{
    name: string;
    description: string;
    body: string;
    source: string;
    fileCount: number;
    hasScripts: boolean;
    securityStatus?: string | null;
    securityWarning?: string | null;
  }>;
  // Optional: execute a script bundled inside an installed skill (e.g.
  // skills/<name>/scripts/<file>). Wired by the host against the skills dir.
  // Lets installed skills actually do work — without this the brain can read a
  // skill's instructions but can't run its tools.
  execSkillScript?: (args: {
    skill: string;
    script: string;
    args?: string[];
    stdin?: string;
    timeoutSec?: number;
  }) => Promise<{
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    runDir: string;
    outputs: string[];
    timedOut?: boolean;
    error?: string;
  }>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Anthropic.Messages.Tool["input_schema"];
  run: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolConfig<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  inputSchema: Anthropic.Messages.Tool["input_schema"];
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends z.ZodTypeAny>(cfg: ToolConfig<S>): ToolDef {
  return {
    name: cfg.name,
    description: cfg.description,
    inputSchema: cfg.inputSchema,
    run: (input, ctx) => cfg.run(cfg.schema.parse(input), ctx),
  };
}

export function asAnthropicTool(def: ToolDef): Anthropic.Messages.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema,
  };
}
