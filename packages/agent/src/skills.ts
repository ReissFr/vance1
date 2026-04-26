// agentskills.io-compliant skill loader. Each skill is a directory with a
// SKILL.md (YAML frontmatter + Markdown body). The index (name+description for
// each skill) goes into the system prompt at startup; the full body is
// loaded on-demand via the load_skill tool. Follows the progressive-disclosure
// pattern from the spec.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface SkillMetadata {
  name: string;
  description: string;
  dir: string;
}

export interface SkillBody {
  name: string;
  description: string;
  body: string;
}

// Parse the tiny subset of YAML frontmatter we care about: top-level string
// keys (name, description, license, compatibility). Anything else is ignored.
// Keeps the loader dependency-free.
function parseFrontmatter(src: string): Record<string, string> {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const rawLine of m[1]!.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    if (/^\s/.test(line)) continue; // nested key — skip
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) out[key] = val;
  }
  return out;
}

function stripFrontmatter(src: string): string {
  return src.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart();
}

export async function loadSkillIndex(skillsDir: string): Promise<SkillMetadata[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }
  const out: SkillMetadata[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dir = join(skillsDir, entry);
    const st = await stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const skillPath = join(dir, "SKILL.md");
    const src = await readFile(skillPath, "utf8").catch(() => null);
    if (!src) continue;
    const fm = parseFrontmatter(src);
    if (!fm.name || !fm.description) continue;
    if (fm.name !== entry) continue; // spec: name must match directory
    out.push({ name: fm.name, description: fm.description, dir });
  }
  return out;
}

export async function loadSkillBody(skillsDir: string, name: string): Promise<SkillBody | null> {
  // Enforce name constraints so the tool can't be used to read arbitrary files.
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return null;
  const dir = join(skillsDir, name);
  const src = await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null);
  if (!src) return null;
  const fm = parseFrontmatter(src);
  if (!fm.name || !fm.description) return null;
  return {
    name: fm.name,
    description: fm.description,
    body: stripFrontmatter(src),
  };
}
