import { backgroundAgentToTool } from "./registry";
import { writerAgent } from "./writer";
import type { ToolDef } from "../tools/types";

// Canonical list of first-party BackgroundAgents. Each entry becomes a
// ToolDef the brain can invoke — migrating an existing "*_agent" tool just
// means moving its config here.
export const BACKGROUND_AGENTS = [writerAgent] as const;

export const BACKGROUND_AGENT_TOOLS: ToolDef[] = BACKGROUND_AGENTS.map((a) =>
  backgroundAgentToTool(a),
);

export { backgroundAgentToTool, defineBackgroundAgent } from "./registry";
export { enqueueTaskRow, runBackgroundAgent } from "./helpers";
export type {
  BackgroundAgent,
  BackgroundAgentConfig,
  BuildTaskRowArgs,
  BuildTaskRowResult,
} from "./types";
