import { z } from "zod";
import { defineTool } from "./types";

// Two-phase install. The brain MUST call preview first, show the user the
// skill metadata + body, get explicit approval, and only then call again with
// confirm=true. Skill bodies are loaded as trusted guidance — a malicious
// skill can tell the brain to exfiltrate data. Human review is the gate.

export const installSkillTool = defineTool({
  name: "install_skill",
  description:
    "Install a skill from a public agentskills.io-compatible source. TWO-PHASE: first call with confirm=false to preview (returns metadata + body); show the user the preview, get explicit approval, then call again with confirm=true to actually install. Accepts: 'github:owner/repo[/path][@ref]', 'clawhub:<slug>[@version]' (ClawHub registry), a https://github.com/.../tree/... URL, or a raw https URL pointing at a SKILL.md.",
  schema: z.object({
    source: z.string().min(3).max(500),
    confirm: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          "Where to fetch the skill from. Examples: 'github:anthropics/skills/pdf', 'clawhub:sonoscli', 'clawhub:sonoscli@1.0.0', 'https://github.com/owner/repo/tree/main/skills/foo', or a raw SKILL.md URL.",
      },
      confirm: {
        type: "boolean",
        description:
          "False (default) returns a preview only. True actually installs — only set after the user has seen the preview and approved.",
      },
    },
    required: ["source"],
  },
  async run(input, ctx) {
    const confirm = input.confirm === true;

    if (!confirm) {
      if (!ctx.previewSkill) {
        return { ok: false, error: "skill preview not available in this context" };
      }
      try {
        const preview = await ctx.previewSkill(input.source);
        const warnings: string[] = [];
        if (preview.hasScripts) {
          warnings.push("This skill ships executable scripts. Only install if you trust the source.");
        }
        if (preview.securityWarning) warnings.push(preview.securityWarning);
        return {
          ok: true,
          phase: "preview",
          name: preview.name,
          description: preview.description,
          source: preview.source,
          fileCount: preview.fileCount,
          hasScripts: preview.hasScripts,
          securityStatus: preview.securityStatus ?? null,
          bodyExcerpt: preview.body,
          warnings: warnings.length > 0 ? warnings : undefined,
          hint: "Show this preview to the user. DO NOT install without explicit approval. If approved, call again with confirm=true.",
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    if (!ctx.installSkill) {
      return { ok: false, error: "skill install not available in this context" };
    }
    try {
      const result = await ctx.installSkill(input.source);
      return {
        ok: true,
        phase: "installed",
        name: result.name,
        files: result.files,
        hint: "Skill installed. It appears in <available_skills> on the next message.",
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
