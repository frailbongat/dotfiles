/**
 * The two ways `/ship` avoids paying for the same lint twice: what the agent
 * already ran clean in this session, and the tool's own result cache.
 *
 * The workflow ends in a quality-gate batch: the agent runs the repo's lint and
 * format scripts before it hands the diff over. Re-running them inside `/ship`
 * costs seconds and can only ever find something the agent's run already found.
 *
 * A recorded run is trusted only when it was repo-wide, exited zero, and every
 * file being committed is older than it. The mtime comparison is what makes the
 * skip safe: an edit made in an editor after the agent's run, which no session
 * event would ever report, still forces the check to run.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** Tool binaries whose runs are worth remembering, keyed to CheckSpec labels. */
const KNOWN_TOOLS = new Set(["eslint", "prettier", "ruff", "gofmt", "rustfmt"]);
const RUFF_SUBCOMMANDS = new Set(["check", "format"]);
const PACKAGE_RUNNERS = new Set(["pnpm", "npm", "yarn", "bun", "deno", "npx"]);
const RUN_WORDS = new Set(["run", "run-script", "exec", "dlx", "x", "--"]);
/** Args that widen a run back to the whole repo rather than scoping it. */
const REPO_WIDE_ARGS = new Set([".", "./", "**", "**/*"]);
const SEGMENT_SEPARATORS = /(?:&&|\|\||[;\n|])/;

export interface CheckLedger {
  /** Remember a finished shell command. Non-zero exits are ignored. */
  record(command: string, cwd: string, ok: boolean): void;
  /** When the label last ran clean and repo-wide, in epoch milliseconds. */
  cleanAt(label: string): number | undefined;
}

/**
 * Splits a command line into words, treating a quoted run as one word so a
 * glob like `"src/**\/*.ts"` is seen as the single scoping argument it is.
 */
function tokenize(segment: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of segment.matchAll(pattern)) {
    words.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return words.filter(Boolean);
}

/** Drops `pnpm exec`, `npx --yes`, and env assignments from the front. */
function stripRunnerPrefix(words: string[]): string[] {
  let index = 0;
  while (index < words.length) {
    const word = words[index]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      index += 1;
      continue;
    }
    const name = basename(word);
    if (PACKAGE_RUNNERS.has(name) || RUN_WORDS.has(name) || name === "time") {
      index += 1;
      continue;
    }
    if (word.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }
  return words.slice(index);
}

function readScripts(cwd: string): Record<string, string> {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Rewrites `pnpm lint` into the command the script actually runs, so a run
 * hidden behind a package script is recognised. Three passes, because scripts
 * chain into other scripts and a cycle must not spin.
 */
export function expandScripts(
  command: string,
  scripts: Record<string, string>,
): string {
  let expanded = command;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const next = expanded
      .split(SEGMENT_SEPARATORS)
      .map((segment) => {
        const words = tokenize(segment);
        if (words.length === 0) return segment;
        const runner = basename(words[0]!);
        if (!PACKAGE_RUNNERS.has(runner)) return segment;

        const rest = words.slice(1).filter((word) => !RUN_WORDS.has(word));
        const script = rest[0];
        if (!script || !scripts[script]) return segment;
        changed = true;
        return scripts[script]!;
      })
      .join(" && ");
    if (!changed) return expanded;
    expanded = next;
  }
  return expanded;
}

/**
 * The check labels this command ran across the whole repository.
 *
 * A run with an explicit path or glob is deliberately not counted: the agent
 * linting one file it just touched says nothing about the other four in the
 * commit, and guessing at coverage is how an unlinted change reaches the trunk.
 */
export function repoWideLabels(command: string): string[] {
  const labels: string[] = [];

  for (const segment of command.split(SEGMENT_SEPARATORS)) {
    const words = stripRunnerPrefix(tokenize(segment));
    const tool = basename(words[0] ?? "");
    if (!KNOWN_TOOLS.has(tool)) continue;

    let args = words.slice(1);
    let label = tool;
    if (tool === "ruff") {
      const subcommand = args.find((word) => !word.startsWith("-"));
      if (!subcommand || !RUFF_SUBCOMMANDS.has(subcommand)) continue;
      label = `ruff ${subcommand}`;
      args = args.filter((word) => word !== subcommand);
    }

    const scoped = args.some(
      (word) => !word.startsWith("-") && !REPO_WIDE_ARGS.has(word),
    );
    if (scoped) continue;
    labels.push(label);
  }

  return labels;
}

export function createCheckLedger(): CheckLedger {
  const clean = new Map<string, number>();
  const scriptCache = new Map<string, Record<string, string>>();

  return {
    record(command, cwd, ok) {
      if (!ok || !command.trim()) return;
      // `eslint | tail` and `eslint; echo done` both exit zero while eslint
      // fails, so a clean exit from either says nothing. `&&` chains keep the
      // failure, so they are the only compound form worth reading.
      if (/[|;]/.test(command)) return;
      let scripts = scriptCache.get(cwd);
      if (!scripts) {
        scripts = readScripts(cwd);
        scriptCache.set(cwd, scripts);
      }
      const labels = repoWideLabels(expandScripts(command, scripts));
      const at = Date.now();
      for (const label of labels) clean.set(label, at);
    },
    cleanAt(label) {
      return clean.get(label);
    },
  };
}

/** True when nothing in `files` has been touched since `at`. */
export function untouchedSince(
  files: readonly string[],
  repoRoot: string,
  at: number,
): boolean {
  for (const file of files) {
    try {
      if (statSync(join(repoRoot, file)).mtimeMs > at) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Files whose change can alter a lint result without altering a source file. */
const DEPENDENCY_MANIFESTS = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

export function modifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The cache file for a spec, dropped first when it may have gone stale.
 *
 * eslint rehashes the resolved config per file, so an edited rule set
 * invalidates itself. A plugin upgraded underneath the same config does not,
 * which is what the manifest check is for.
 */
export function prepareCache(
  label: string,
  repoRoot: string,
  gitDir: string,
): string {
  const cacheFile = join(gitDir, `ship-${label.replace(/\s+/g, "-")}-cache`);
  const cachedAt = modifiedAt(cacheFile);
  const stale = DEPENDENCY_MANIFESTS.some(
    (manifest) => modifiedAt(join(repoRoot, manifest)) > cachedAt,
  );
  if (cachedAt > 0 && stale) rmSync(cacheFile, { force: true });
  return cacheFile;
}

export function filesForSpec(files: string[], spec: CheckSpec): string[] {
  return files.filter((file) => {
    const dot = file.lastIndexOf(".");
    if (dot < 0) return false;
    return spec.exts.includes(file.slice(dot + 1).toLowerCase());
  });
}

export async function resolveTool(
  pi: ExtensionAPI,
  spec: CheckSpec,
  repoRoot: string,
): Promise<string | undefined> {
  if (spec.source === "local") {
    const binary = join(repoRoot, "node_modules", ".bin", spec.tool);
    return existsSync(binary) ? binary : undefined;
  }
  const found = await pi.exec("which", [spec.tool], { cwd: repoRoot, timeout: GIT_TIMEOUT_MS });
  return found.code === 0 && found.stdout.trim() ? spec.tool : undefined;
}
