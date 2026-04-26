// Registry: turns BackgroundAgentConfig definitions into ToolDefs the brain
// can consume, and holds the canonical list of first-party async agents.

import type { z } from "zod";
import type { ToolDef } from "../tools/types";
import { runBackgroundAgent } from "./helpers";
import type { BackgroundAgentConfig } from "./types";

export function defineBackgroundAgent<S extends z.ZodTypeAny>(
  cfg: BackgroundAgentConfig<S>,
): BackgroundAgentConfig<S> {
  return cfg;
}

export function backgroundAgentToTool<S extends z.ZodTypeAny>(
  cfg: BackgroundAgentConfig<S>,
): ToolDef {
  return {
    name: cfg.name,
    description: cfg.description,
    inputSchema: cfg.inputSchema,
    run: (input, ctx) => runBackgroundAgent(cfg, input, ctx),
  };
}
