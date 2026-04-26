import { z } from "zod";
import { defineTool } from "./types";

// The agent sees each skill's name + description in the system prompt. When a
// task matches a skill, it calls load_skill(name) to pull the full body of
// instructions on demand. Progressive disclosure — spec section 3.

export const loadSkillTool = defineTool({
  name: "load_skill",
  description:
    "Load the full instructions for a skill by name. The available skills (name + short description) are listed in your system prompt under <available_skills>. Call this when the current task matches a skill — the returned body contains step-by-step guidance. One skill per call.",
  schema: z.object({ name: z.string().min(1).max(64) }),
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The skill name from the <available_skills> list. Lowercase letters, numbers, hyphens only.",
      },
    },
    required: ["name"],
  },
  async run(input, ctx) {
    if (!ctx.loadSkillBody) {
      return { ok: false, error: "skills not available in this context" };
    }
    const skill = await ctx.loadSkillBody(input.name);
    if (!skill) return { ok: false, error: `skill "${input.name}" not found` };
    return { ok: true, name: skill.name, body: skill.body };
  },
});
