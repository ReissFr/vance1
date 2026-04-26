// Install agentskills.io-compatible skills from remote sources into the local
// skills directory.
//
// Accepted input forms:
//   github:owner/repo
//   github:owner/repo/path/to/skill
//   github:owner/repo/path@ref
//   https://github.com/owner/repo/tree/<ref>[/path]
//   https://<anything>/SKILL.md
//   clawhub:<slug>[@<version>]     — ClawHub registry (clawhub.ai)

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

export interface SkillInstallResult {
  name: string;
  dir: string;
  files: number;
}

export interface SkillPreview {
  name: string;
  description: string;
  body: string;
  source: string;
  fileCount: number;
  hasScripts: boolean;
  // ClawHub-sourced skills only: "clean" | "suspicious" | "malicious" | null
  securityStatus?: string | null;
  securityWarning?: string | null;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALLOWED_SUBDIRS = /^(scripts|references|assets)\//;
const UA = "jarvis-skill-installer";

type ParsedSource =
  | { kind: "github"; owner: string; repo: string; path: string; ref: string }
  | { kind: "clawhub"; slug: string; version: string | null }
  | { kind: "raw"; url: string };

function parseSource(input: string): ParsedSource {
  const s = input.trim();
  const gh = s.match(/^github:([^/\s]+)\/([^/@\s]+)(?:\/([^@\s]+?))?(?:@(\S+))?$/);
  if (gh) {
    return { kind: "github", owner: gh[1]!, repo: gh[2]!, path: gh[3] ?? "", ref: gh[4] ?? "HEAD" };
  }
  const ch = s.match(/^clawhub:([a-z0-9][a-z0-9-]*)(?:@(\S+))?$/);
  if (ch) {
    return { kind: "clawhub", slug: ch[1]!, version: ch[2] ?? null };
  }
  const url = s.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/);
  if (url) {
    return { kind: "github", owner: url[1]!, repo: url[2]!, path: url[4] ?? "", ref: url[3]! };
  }
  if (s.startsWith("https://")) return { kind: "raw", url: s };
  throw new Error(`unrecognised skill source: ${input}`);
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return await r.text();
}

interface ClawhubBundle {
  version: string;
  files: Record<string, Uint8Array>;
  securityStatus: string | null;
}

async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  const delays = [0, 1000, 3000];
  let lastErr: Error | null = null;
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const r = await fetch(url, init);
    if (r.ok) return r;
    if (r.status !== 429 && r.status < 500) {
      throw new Error(`${label}: ${r.status}`);
    }
    lastErr = new Error(`${label}: ${r.status}`);
  }
  throw lastErr ?? new Error(`${label}: failed after retries`);
}

async function clawhubFetchBundle(slug: string, version: string | null): Promise<ClawhubBundle> {
  const base = "https://clawhub.ai";
  const jsonHeaders = { "user-agent": UA, accept: "application/json" };
  // Resolve latest if unspecified by reading the skill meta's tags.latest.
  let resolved = version;
  if (!resolved) {
    const metaRes = await fetchWithRetry(
      `${base}/api/v1/skills/${encodeURIComponent(slug)}`,
      { headers: jsonHeaders },
      `clawhub skill ${slug}`,
    );
    const meta = (await metaRes.json()) as { skill?: { tags?: { latest?: string } } };
    const latest = meta.skill?.tags?.latest;
    if (!latest) throw new Error(`clawhub skill ${slug}: no latest version`);
    resolved = latest;
  }

  // Pull the version metadata for the security scan verdict.
  let securityStatus: string | null = null;
  try {
    const verRes = await fetchWithRetry(
      `${base}/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(resolved)}`,
      { headers: jsonHeaders },
      `clawhub version ${slug}@${resolved}`,
    );
    const ver = (await verRes.json()) as { version?: { security?: { status?: string } } };
    securityStatus = ver.version?.security?.status ?? null;
  } catch {
    // Security metadata is best-effort; missing it doesn't block install.
  }

  // Download the ZIP.
  const zipRes = await fetchWithRetry(
    `${base}/api/v1/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(resolved)}`,
    { headers: { "user-agent": UA } },
    `clawhub download ${slug}@${resolved}`,
  );
  const buf = new Uint8Array(await zipRes.arrayBuffer());
  const files = unzipSync(buf);
  return { version: resolved, files, securityStatus };
}

function securityWarningFor(status: string | null): string | null {
  if (!status || status === "clean") return null;
  if (status === "suspicious") return "ClawHub scan flagged this skill as suspicious. Review the body carefully before installing.";
  if (status === "malicious") return "ClawHub scan flagged this skill as MALICIOUS. Do not install.";
  return `ClawHub security status: ${status}. Review before installing.`;
}

async function ghListTree(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ sha: string; tree: Array<{ path: string; type: string }> }> {
  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, {
    headers: { "user-agent": UA, accept: "application/vnd.github+json" },
  });
  if (!commitRes.ok) throw new Error(`github commit ${ref}: ${commitRes.status}`);
  const commit = (await commitRes.json()) as { sha: string; commit: { tree: { sha: string } } };
  const sha = commit.sha;
  const treeSha = commit.commit.tree.sha;
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers: { "user-agent": UA, accept: "application/vnd.github+json" } },
  );
  if (!treeRes.ok) throw new Error(`github tree: ${treeRes.status}`);
  const body = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
  return { sha, tree: body.tree ?? [] };
}

function parseFrontmatterNameDesc(src: string): { name?: string; description?: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1]!.split("\n")) {
    if (!line || /^\s/.test(line)) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k === "name" && v) out.name = v;
    if (k === "description" && v) out.description = v;
  }
  return out;
}

export async function previewSkill(source: string): Promise<SkillPreview> {
  const parsed = parseSource(source);

  if (parsed.kind === "clawhub") {
    const bundle = await clawhubFetchBundle(parsed.slug, parsed.version);
    const skillMd = bundle.files["SKILL.md"];
    if (!skillMd) throw new Error("clawhub bundle missing SKILL.md");
    const md = strFromU8(skillMd);
    const fm = parseFrontmatterNameDesc(md);
    if (!fm.name || !fm.description) throw new Error("SKILL.md missing name or description");
    if (!NAME_RE.test(fm.name)) throw new Error(`invalid skill name: ${fm.name}`);
    const relevant = Object.keys(bundle.files).filter(
      (p) => p === "SKILL.md" || ALLOWED_SUBDIRS.test(p),
    );
    const hasScripts = relevant.some((p) => p.startsWith("scripts/"));
    return {
      name: fm.name,
      description: fm.description,
      body: md.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart().slice(0, 2000),
      source: `clawhub:${parsed.slug}@${bundle.version}`,
      fileCount: relevant.length,
      hasScripts,
      securityStatus: bundle.securityStatus,
      securityWarning: securityWarningFor(bundle.securityStatus),
    };
  }

  if (parsed.kind === "raw") {
    const md = await fetchText(parsed.url);
    const fm = parseFrontmatterNameDesc(md);
    if (!fm.name || !fm.description) throw new Error("SKILL.md missing name or description");
    if (!NAME_RE.test(fm.name)) throw new Error(`invalid skill name: ${fm.name}`);
    return {
      name: fm.name,
      description: fm.description,
      body: md.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart().slice(0, 2000),
      source,
      fileCount: 1,
      hasScripts: false,
    };
  }

  const { owner, repo, path, ref } = parsed;
  const { sha, tree } = await ghListTree(owner, repo, ref);
  const prefix = path ? path.replace(/\/$/, "") + "/" : "";
  const entries = tree.filter((e) => e.type === "blob" && (!prefix || e.path.startsWith(prefix)));
  if (!entries.some((e) => e.path === prefix + "SKILL.md")) {
    throw new Error(`no SKILL.md at ${prefix || "<repo root>"}`);
  }
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/`;
  const md = await fetchText(rawBase + prefix + "SKILL.md");
  const fm = parseFrontmatterNameDesc(md);
  if (!fm.name || !fm.description) throw new Error("SKILL.md missing name or description");
  if (!NAME_RE.test(fm.name)) throw new Error(`invalid skill name: ${fm.name}`);

  const relevant = entries.filter((e) => {
    const rel = e.path.slice(prefix.length);
    return rel === "SKILL.md" || ALLOWED_SUBDIRS.test(rel);
  });
  const hasScripts = relevant.some((e) => e.path.slice(prefix.length).startsWith("scripts/"));

  return {
    name: fm.name,
    description: fm.description,
    body: md.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart().slice(0, 2000),
    source,
    fileCount: relevant.length,
    hasScripts,
  };
}

export async function installSkill(
  source: string,
  skillsDir: string,
): Promise<SkillInstallResult> {
  const parsed = parseSource(source);

  if (parsed.kind === "clawhub") {
    const bundle = await clawhubFetchBundle(parsed.slug, parsed.version);
    if (bundle.securityStatus === "malicious") {
      throw new Error("ClawHub flagged this skill as malicious; refusing to install.");
    }
    const skillMd = bundle.files["SKILL.md"];
    if (!skillMd) throw new Error("clawhub bundle missing SKILL.md");
    const md = strFromU8(skillMd);
    const fm = parseFrontmatterNameDesc(md);
    if (!fm.name || !fm.description) throw new Error("SKILL.md missing name or description");
    if (!NAME_RE.test(fm.name)) throw new Error(`invalid skill name: ${fm.name}`);
    const dir = join(skillsDir, fm.name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    let count = 0;
    for (const [rel, bytes] of Object.entries(bundle.files)) {
      if (rel !== "SKILL.md" && !ALLOWED_SUBDIRS.test(rel)) continue;
      const out = join(dir, rel);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, bytes);
      count++;
    }
    return { name: fm.name, dir, files: count };
  }

  if (parsed.kind === "raw") {
    const md = await fetchText(parsed.url);
    const fm = parseFrontmatterNameDesc(md);
    if (!fm.name || !fm.description) throw new Error("SKILL.md missing name or description");
    if (!NAME_RE.test(fm.name)) throw new Error(`invalid skill name: ${fm.name}`);
    const dir = join(skillsDir, fm.name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), md, "utf8");
    return { name: fm.name, dir, files: 1 };
  }

  const { owner, repo, path, ref } = parsed;
  const { sha, tree } = await ghListTree(owner, repo, ref);
  const prefix = path ? path.replace(/\/$/, "") + "/" : "";
  const entries = tree.filter((e) => e.type === "blob" && (!prefix || e.path.startsWith(prefix)));
  const hasSkillMd = entries.some((e) => e.path === prefix + "SKILL.md");
  if (!hasSkillMd) throw new Error(`no SKILL.md at ${prefix || "<repo root>"}`);

  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/`;
  const md = await fetchText(rawBase + prefix + "SKILL.md");
  const fm = parseFrontmatterNameDesc(md);
  if (!fm.name || !fm.description) throw new Error("SKILL.md missing name or description");
  if (!NAME_RE.test(fm.name)) throw new Error(`invalid skill name: ${fm.name}`);

  const dir = join(skillsDir, fm.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  let count = 0;
  for (const entry of entries) {
    const rel = entry.path.slice(prefix.length);
    if (!rel) continue;
    if (rel !== "SKILL.md" && !ALLOWED_SUBDIRS.test(rel)) continue;
    const body = await fetchText(rawBase + entry.path);
    const out = join(dir, rel);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, body, "utf8");
    count++;
  }
  return { name: fm.name, dir, files: count };
}
