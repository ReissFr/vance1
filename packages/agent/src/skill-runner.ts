// Executes a script bundled inside an installed skill. Bundled scripts live at
// skills/<skill>/scripts/<file>. We run them with cwd = a fresh per-run output
// dir so the script can drop generated files (PNGs, PDFs, etc.) without
// stomping anything else, and we return the paths of any files it produced.
//
// Python deps: scripts using `# /// script` PEP 723 inline metadata get their
// deps resolved automatically when run via `uv` (preferred). Without uv we
// fall back to `python3` and the script must rely on system-installed deps.

import { spawn } from "node:child_process";
import { mkdir, readdir, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export interface ExecSkillScriptArgs {
  skill: string;
  script: string;
  args?: string[];
  stdin?: string;
  timeoutSec?: number;
}

export interface ExecSkillScriptResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  runDir: string;
  outputs: string[];
  timedOut?: boolean;
  error?: string;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_SEC = 60;
const MAX_TIMEOUT_SEC = 300;

function truncate(buf: Buffer): string {
  if (buf.length <= MAX_OUTPUT_BYTES) return buf.toString("utf8");
  return buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + `\n…(truncated, ${buf.length - MAX_OUTPUT_BYTES} bytes omitted)`;
}

let uvAvailable: boolean | null = null;
function findUv(): boolean {
  if (uvAvailable !== null) return uvAvailable;
  const candidates = [
    process.env.HOME ? join(process.env.HOME, ".local/bin/uv") : null,
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
    "/usr/bin/uv",
  ].filter((p): p is string => p !== null);
  uvAvailable = candidates.some((p) => existsSync(p));
  return uvAvailable;
}

function uvBin(): string {
  const candidates = [
    process.env.HOME ? join(process.env.HOME, ".local/bin/uv") : null,
    "/opt/homebrew/bin/uv",
    "/usr/local/bin/uv",
    "/usr/bin/uv",
  ].filter((p): p is string => p !== null);
  return candidates.find((p) => existsSync(p)) ?? "uv";
}

function pickRunner(scriptPath: string): { cmd: string; args: string[] } {
  const ext = extname(scriptPath).toLowerCase();
  if (ext === ".py") {
    if (findUv()) return { cmd: uvBin(), args: ["run", "--quiet", scriptPath] };
    return { cmd: "python3", args: [scriptPath] };
  }
  if (ext === ".sh") return { cmd: "bash", args: [scriptPath] };
  if (ext === ".js" || ext === ".mjs") return { cmd: "node", args: [scriptPath] };
  if (ext === ".ts") return { cmd: "npx", args: ["-y", "tsx", scriptPath] };
  // No extension or unknown: try executing directly.
  return { cmd: scriptPath, args: [] };
}

export async function execSkillScript(
  skillsDir: string,
  input: ExecSkillScriptArgs,
): Promise<ExecSkillScriptResult> {
  if (!NAME_RE.test(input.skill)) {
    return makeError(`invalid skill name: ${input.skill}`);
  }
  // The script path must stay inside the skill's scripts/ subdir. Resolve to
  // a real path and verify it sits under the expected prefix to defeat
  // ../ traversal attempts even via symlinks.
  const skillRoot = resolve(skillsDir, input.skill);
  const scriptsRoot = resolve(skillRoot, "scripts");
  const requested = resolve(scriptsRoot, input.script);
  if (!requested.startsWith(scriptsRoot + sep) && requested !== scriptsRoot) {
    return makeError(`script path escapes scripts/ dir`);
  }
  if (!existsSync(requested)) {
    return makeError(`script not found: ${input.script}`);
  }
  let realScript: string;
  try {
    realScript = await realpath(requested);
  } catch {
    return makeError(`could not resolve script path`);
  }
  const realScriptsRoot = await realpath(scriptsRoot).catch(() => scriptsRoot);
  if (!realScript.startsWith(realScriptsRoot + sep) && realScript !== realScriptsRoot) {
    return makeError(`script path escapes scripts/ dir (post-symlink)`);
  }

  const runId = randomBytes(8).toString("hex");
  const runDir = join(tmpdir(), "jarvis-skill-runs", input.skill, runId);
  await mkdir(runDir, { recursive: true });

  const { cmd, args: runnerArgs } = pickRunner(realScript);
  const userArgs = (input.args ?? []).map(String);
  const fullArgs = [...runnerArgs, ...userArgs];
  const timeoutMs =
    Math.min(Math.max(input.timeoutSec ?? DEFAULT_TIMEOUT_SEC, 1), MAX_TIMEOUT_SEC) * 1000;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JARVIS_SKILL_DIR: skillRoot,
    JARVIS_RUN_DIR: runDir,
    // Make sure homebrew/uv-installed bins are findable.
    PATH: [
      process.env.HOME ? join(process.env.HOME, ".local/bin") : null,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH ?? "",
    ]
      .filter(Boolean)
      .join(":"),
  };

  return await new Promise<ExecSkillScriptResult>((resolvePromise) => {
    const child = spawn(cmd, fullArgs, {
      cwd: runDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore.
      }
    }, timeoutMs);

    child.stdout?.on("data", (b: Buffer) => {
      stdoutBytes += b.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES * 2) stdoutChunks.push(b);
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderrBytes += b.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES * 2) stderrChunks.push(b);
    });

    if (input.stdin) {
      try {
        child.stdin?.end(input.stdin);
      } catch {
        // Ignore.
      }
    } else {
      try {
        child.stdin?.end();
      } catch {
        // Ignore.
      }
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        exitCode: null,
        stdout: truncate(Buffer.concat(stdoutChunks)),
        stderr: truncate(Buffer.concat(stderrChunks)),
        runDir,
        outputs: [],
        error: err.message,
      });
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      const outputs = await listOutputs(runDir);
      resolvePromise({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout: truncate(Buffer.concat(stdoutChunks)),
        stderr: truncate(Buffer.concat(stderrChunks)),
        runDir,
        outputs,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}

async function listOutputs(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile()) {
        const s = await stat(p);
        if (s.size > 0) out.push(p);
      }
    }
  } catch {
    // Ignore — best-effort listing.
  }
  return out;
}

function makeError(error: string): ExecSkillScriptResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    runDir: "",
    outputs: [],
    error,
  };
}
