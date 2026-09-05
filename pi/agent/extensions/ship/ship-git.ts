/**
 * Git plumbing with no pi runtime behind it.
 *
 * Everything here takes the command runner as an argument and declares its own
 * structural result type, the same way `ship-repository.ts` does, so it can be
 * unit-tested without loading the extension host.
 */

/** Beyond this, argv length and runtime stop being worth it. */
const MAX_ERROR_OUTPUT = 2_000;
const REBASE_TIMEOUT_MS = 120_000;
/** One sync per rejection, and a rejection means someone else just landed. */
const PUSH_ATTEMPTS = 3;

export type GitCommandResult = {
  stdout: string;
  stderr?: string;
  code: number;
  killed?: boolean;
};

export type Git = (
  args: string[],
  timeout?: number,
) => Promise<GitCommandResult>;

export function displayOutput(result: GitCommandResult): string {
  const output = [result.stderr?.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join("\n");
  if (!output) return "";
  return output.length <= MAX_ERROR_OUTPUT
    ? output
    : `${output.slice(0, MAX_ERROR_OUTPUT)}\n…`;
}

export async function remoteRefExists(
  git: Git,
  ref: string,
): Promise<boolean> {
  const result = await git([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${ref}`,
  ]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

/**
 * Unmerged index entries, from any source: a rebase paused on a conflict, or
 * an autostash pop that conflicted after the rebase itself succeeded.
 */
export async function listUnmergedPaths(git: Git): Promise<string[]> {
  const unmerged = await git(["ls-files", "--unmerged", "-z"]);
  if (unmerged.code !== 0) return [];
  return [
    ...new Set(
      unmerged.stdout
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.split("\t")[1] ?? entry),
    ),
  ];
}

/**
 * A rebase can report success while leaving conflicts in the index, because
 * `--autostash` pops after the replay and the pop is not part of the rebase's
 * exit code. Committing then would ship `<<<<<<<` into the trunk.
 */
async function assertNoUnmergedPaths(git: Git, landOn: string): Promise<void> {
  const paths = await listUnmergedPaths(git);
  if (paths.length === 0) return;

  throw new RebaseConflictError(
    "index",
    landOn,
    paths,
    `Rebasing onto origin/${landOn} succeeded, but reapplying the uncommitted ` +
      "working-tree changes (the rebase autostash) left conflicts in the index, " +
      "so nothing was pushed. The pre-rebase snapshot is still in `git stash list` " +
      "as the autostash entry.",
  );
}

/** Reasons a rebase never started, where `--abort` is also going to fail. */
function rebaseHint(result: GitCommandResult): string {
  const output = `${result.stderr ?? ""}\n${result.stdout}`;
  if (/untracked working tree files would be overwritten/i.test(output)) {
    return "\nUntracked files collide with the incoming commits. --autostash does not stash untracked files; move or delete them, then retry.";
  }
  if (/local changes .* would be overwritten|cannot rebase: you have unstaged/i.test(output)) {
    return "\nThe working tree could not be stashed. Commit or stash it yourself, then retry.";
  }
  return "";
}

/**
 * A git conflict that stopped a ship, deliberately left in place.
 *
 * A conflict is a decision, and ship still refuses to make it. What changed is
 * who gets handed the decision: the state used to be cleaned up and the user
 * told to redo everything by hand, which threw away exactly what a resolver
 * needs. Now the conflict stays on disk and this error carries enough for the
 * extension to hand resolution to the agent, or for a human to finish it.
 *
 * Two kinds, because what "finish" means differs:
 * - `rebase`: the rebase is paused mid-conflict. Resolve, stage, continue.
 * - `index`: no operation is in progress, but the index holds unmerged
 *   entries, the shape an autostash pop leaves behind. One side of each
 *   conflict is uncommitted local work. Resolve and stage; nothing to
 *   continue or abort.
 *
 * `afterResolution` is set by callers that know what has to happen once the
 * conflict is resolved: nothing extra before a commit exists, a push after
 * one does.
 */
export class RebaseConflictError extends Error {
  readonly kind: "rebase" | "index";
  readonly landOn: string;
  readonly paths: readonly string[];
  afterResolution?: string;

  constructor(
    kind: "rebase" | "index",
    landOn: string,
    paths: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = "RebaseConflictError";
    this.kind = kind;
    this.landOn = landOn;
    this.paths = paths;
  }

  /** What a human does about it, for the no-handoff error path. */
  get manualAdvice(): string {
    return this.kind === "rebase"
      ? "Resolve the conflicts and `git rebase --continue`, or `git rebase --abort` to stand down."
      : "Resolve the conflicts, then stage the resolved files with `git add` to clear the unmerged entries.";
  }
}

/**
 * Replays HEAD onto a trunk that moved under it.
 *
 * The old failure told the user to go and do exactly this by hand, and there
 * was never a second option: the push is a fast-forward or it is nothing. So it
 * runs itself, and only a conflict is handed back, because a conflict is a
 * decision and this command is not the place to make it.
 *
 * `--autostash` is what makes it work in both places it runs. Before the checks
 * the tree is still full of the unstaged edits the ship is about to sweep in,
 * and after the commit a formatter may have left more behind; a plain rebase
 * refuses on either.
 */
async function rebaseOntoLandingRef(git: Git, landOn: string): Promise<void> {
  const rebased = await git(
    ["rebase", "--autostash", `origin/${landOn}`],
    REBASE_TIMEOUT_MS,
  );
  if (rebased.code === 0 && !rebased.killed) {
    await assertNoUnmergedPaths(git, landOn);
    return;
  }

  // A content conflict is a decision. The rebase stays in progress, because
  // aborting it would throw away the state the resolver needs, and the typed
  // error is how the extension knows to hand that decision to the agent.
  const conflictOutput = `${rebased.stderr ?? ""}\n${rebased.stdout}`;
  if (!rebased.killed && /could not apply|CONFLICT/i.test(conflictOutput)) {
    const paths = await listUnmergedPaths(git);
    throw new RebaseConflictError(
      "rebase",
      landOn,
      paths,
      `origin/${landOn} moved and rebasing onto it hit content conflicts, so nothing was pushed. ` +
        "The rebase is paused mid-conflict.",
    );
  }

  // An abort that fails means the rebase never started, which is the usual case
  // for a tree even --autostash will not touch. Say which it was.
  const aborted = await git(["rebase", "--abort"], REBASE_TIMEOUT_MS);
  const output = displayOutput(rebased);
  throw new Error(
    `origin/${landOn} moved and rebasing onto it failed, so nothing was pushed. Resolve it by hand:${
      output ? `\n${output}` : ""
    }${rebaseHint(rebased)}${
      aborted.code === 0
        ? "\nThe rebase was aborted, so the working tree is where it was."
        : ""
    }`,
  );
}

/**
 * Leaves HEAD a fast-forward of `origin/<landOn>`, rebasing onto it when the
 * trunk moved since the last look.
 *
 * `notify` is called only when there is something to say, so the ordinary run
 * where nothing moved stays silent. The pre-rebase commit goes into the message
 * because a rebase is the one step here that rewrites local history, and that
 * hash is how the reflog gets it back.
 */
export async function ensureFastForward(
  git: Git,
  landOn: string,
  notify: (message: string) => void,
): Promise<void> {
  const fetched = await git(["fetch", "origin", landOn, "--quiet"]);
  if (fetched.code !== 0) {
    throw new Error(
      `Fetching origin/${landOn} failed:\n${displayOutput(fetched)}`,
    );
  }

  const isAncestor = async () =>
    (await git(["merge-base", "--is-ancestor", `origin/${landOn}`, "HEAD"]))
      .code === 0;
  if (await isAncestor()) return;

  const before = (await git(["rev-parse", "--short", "HEAD"])).stdout.trim();
  const behind = (
    await git(["log", "--oneline", `HEAD..origin/${landOn}`])
  ).stdout.trim();
  notify(
    `origin/${landOn} moved; rebasing ${before || "HEAD"} onto it:${
      behind ? `\n${behind}` : ""
    }`,
  );

  await rebaseOntoLandingRef(git, landOn);
  if (await isAncestor()) return;

  throw new Error(
    `Rebasing onto origin/${landOn} reported success but HEAD still does not descend from it, so nothing was pushed. Sort it out by hand:${
      behind ? `\n${behind}` : ""
    }`,
  );
}

/**
 * A rejection that another fetch-and-rebase would fix, as opposed to one that
 * no amount of retrying will: a protected branch, a bad credential, a hook.
 */
export function isStaleRejection(result: GitCommandResult): boolean {
  const output = `${result.stderr ?? ""}\n${result.stdout}`;
  if (/\b(?:protected branch|permission denied|pre-receive hook declined|does not match any)\b/i.test(output)) {
    return false;
  }
  return /non-fast-forward|fetch first|stale info|Updates were rejected|cannot lock ref|failed to lock/i.test(
    output,
  );
}

export interface PushPlan {
  /** The `git push …` argv, minus the leading `push`. */
  readonly args: readonly string[];
  /** Remote branch HEAD must descend from before the push is legal. */
  readonly syncRef: string;
  readonly label: string;
  /**
   * The caller already fetched and fast-forwarded onto `syncRef` in this run,
   * so the first attempt can skip straight to the push.
   */
  readonly presynced?: boolean;
}

/**
 * Push, and survive losing a race.
 *
 * Between the pre-flight fast-forward and the push itself sit the formatters,
 * a model call, and a commit. That is tens of seconds in which a sibling
 * worktree can land on the same branch, and the reward for it is a rejected
 * push and a run thrown away over something a second rebase fixes. So a stale
 * rejection re-syncs and tries again; anything else is returned as it is.
 *
 * The first attempt is optimistic when the caller has already synced: that race
 * is rare, a fetch is the slowest thing in the whole command, and losing the
 * race costs nothing more than the retry that was always going to handle it.
 */
export async function pushWithRetry(
  git: Git,
  plan: PushPlan,
  notify: (message: string) => void,
  timeout: number,
  attempts: number = PUSH_ATTEMPTS,
): Promise<GitCommandResult> {
  let last: GitCommandResult = {
    stdout: "",
    stderr: "no push was attempted",
    code: 1,
    killed: false,
  };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A brand-new branch has no remote counterpart to descend from, and asking
    // to fetch one fails outright rather than reporting nothing to do.
    const optimistic = attempt === 1 && plan.presynced === true;
    if (!optimistic && (await remoteRefExists(git, plan.syncRef))) {
      await ensureFastForward(git, plan.syncRef, notify);
    }

    last = await git(["push", ...plan.args], timeout);
    if (last.code === 0 && !last.killed) return last;
    if (last.killed || !isStaleRejection(last) || attempt === attempts) {
      return last;
    }

    notify(
      `${plan.label} was rejected because origin/${plan.syncRef} moved again; re-syncing and retrying (${attempt}/${attempts - 1}).`,
    );
  }

  return last;
}

/** The worktree that has `branch` checked out, if any worktree does. */
async function worktreeHolding(
  git: Git,
  branch: string,
): Promise<string | undefined> {
  const list = await git(["worktree", "list", "--porcelain"]);
  if (list.code !== 0) return undefined;

  let path: string | undefined;
  for (const line of list.stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
    else if (line.trim() === `branch refs/heads/${branch}` && path) return path;
  }
  return undefined;
}

/**
 * Renders a commit as `9fed34a Subject line` so a sync notice names the work
 * that moved instead of an opaque hash. Falls back to the short hash alone when
 * the subject cannot be read.
 */
async function describeCommit(git: Git, sha: string): Promise<string> {
  const short = sha.slice(0, 7);
  const subject = await git(["log", "-1", "--format=%s", sha]);
  const line = subject.code === 0 ? subject.stdout.trim().split("\n")[0] : "";
  return line ? `${short} ${line}` : short;
}

/**
 * Moves the local trunk branch up to the trunk that was just pushed.
 *
 * Landing `HEAD:main` from a worktree updates `origin/main` and nothing else,
 * so the local `main` sits at whatever it was when the worktree was cut. The
 * next ship from the main checkout then opens with a rejected push, for a
 * commit the user themselves landed an hour earlier.
 *
 * Three shapes, none of which can lose work: no checkout gets a guarded
 * `update-ref`, a clean checkout gets `merge --ff-only`, and a dirty checkout
 * gets told rather than touched.
 */
export async function syncLocalTrunk(
  git: Git,
  trunk: string,
  notify: (message: string) => void,
): Promise<void> {
  const local = await git([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${trunk}`,
  ]);
  const before = local.stdout.trim();
  if (local.code !== 0 || !before) return;

  const remote = (
    await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${trunk}`])
  ).stdout.trim();
  if (!remote || remote === before) return;

  const fastForward = await git([
    "merge-base",
    "--is-ancestor",
    before,
    remote,
  ]);
  if (fastForward.code !== 0) {
    notify(
      `Local ${trunk} has diverged from origin/${trunk}, so it was left alone. Reconcile it when convenient.`,
    );
    return;
  }

  const path = await worktreeHolding(git, trunk);
  if (!path) {
    const updated = await git([
      "update-ref",
      `refs/heads/${trunk}`,
      remote,
      before,
    ]);
    if (updated.code === 0) {
      notify(
        `Fast-forwarded local ${trunk} to ${await describeCommit(git, remote)}.`,
      );
    }
    return;
  }

  const status = await git(["-C", path, "status", "--porcelain"]);
  if (status.code !== 0 || status.stdout.trim()) {
    notify(
      `${path} has ${trunk} checked out with uncommitted changes, so it was left alone. It is behind origin/${trunk}; pull it when convenient.`,
    );
    return;
  }

  const merged = await git(["-C", path, "merge", "--ff-only", `origin/${trunk}`]);
  notify(
    merged.code === 0
      ? `Fast-forwarded ${trunk} to ${await describeCommit(git, remote)} in ${path}.`
      : `${path} is behind origin/${trunk} and could not be fast-forwarded; pull it by hand:\n${displayOutput(merged)}`,
  );
}
