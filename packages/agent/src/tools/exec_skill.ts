import { z } from "zod";
import { defineTool } from "./types";

// Runs a script bundled inside an installed skill (skills/<name>/scripts/<file>).
// This is what makes installed skills actually do work — without it the brain
// can read SKILL.md but can't invoke the script that does the heavy lifting.

export const execSkillScriptTool = defineTool({
  name: "exec_skill_script",
  description:
    "Run a script bundled inside an installed skill. Use this to actually execute a skill's tooling (e.g. a Python script that generates a QR code, OCRs a PDF, transcribes audio). The script runs in a fresh per-run working directory; any files it creates show up in the returned `outputs` array as absolute paths. stdout/stderr are returned for inspection. Python scripts using PEP 723 inline metadata get their dependencies resolved automatically (uv-backed). Workflow: 1) load_skill to read SKILL.md and learn which script + args to use, 2) call exec_skill_script, 3) report the output file path(s) to the user.",
  schema: z.object({
    skill: z.string().min(1).max(64),
    script: z.string().min(1).max(200),
    args: z.array(z.string()).max(50).optional(),
    stdin: z.string().max(100_000).optional(),
    timeout_sec: z.number().int().min(1).max(300).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description: "Installed skill name (matches a folder under skills/).",
      },
      script: {
        type: "string",
        description:
          "Path to the script relative to the skill's scripts/ directory, e.g. 'generate_qr.py'. Cannot escape the scripts/ dir.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description:
          "CLI args passed to the script. Order matters. Each item is shell-escaped automatically.",
      },
      stdin: {
        type: "string",
        description: "Optional stdin payload piped to the script.",
      },
      timeout_sec: {
        type: "number",
        description:
          "Hard timeout in seconds (default 60, max 300). Script is SIGKILLed on timeout.",
      },
    },
    required: ["skill", "script"],
  },
  async run(input, ctx) {
    if (!ctx.execSkillScript) {
      return { ok: false, error: "skill execution not available in this context" };
    }
    return await ctx.execSkillScript({
      skill: input.skill,
      script: input.script,
      ...(input.args ? { args: input.args } : {}),
      ...(input.stdin ? { stdin: input.stdin } : {}),
      ...(input.timeout_sec ? { timeoutSec: input.timeout_sec } : {}),
    });
  },
});
