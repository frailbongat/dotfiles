/**
 * Where a ship goes when nobody said.
 *
 * The whole point of `/ship` taking no argument is that the repository already
 * knows the answer. A worktree branch that was never pushed is a scratch pad,
 * and scratch pads land on the trunk. A branch with a remote counterpart was
 * published on purpose, possibly with a pull request open against it, and
 * pushing it anywhere else would be a surprise.
 *
 * The remote-ref test also covers pull requests without shelling out to `gh`:
 * a pull request cannot exist for a branch that was never pushed, so
 * `origin/<branch>` missing means no pull request exists either.
 *
 * Everything here takes the command runner as an argument, so it is unit
 * testable without an extension host, the same way `ship-git.ts` is.
 */
import { remoteRefExists, type Git } from "./ship-git";

/** What the caller typed, when they overrode the inference. */
export type ShipOverride = "trunk" | "branch";

export type Destination =
  | { readonly kind: "trunk"; readonly ref: string; readonly reason: string }
  | {
      readonly kind: "branch";
      readonly branch: string;
      readonly hasUpstream: boolean;
      readonly reason: string;
    };

/** Only consulted when `origin/HEAD` is unset, which `git clone` never leaves. */
const TRUNK_CANDIDATES = ["main", "master", "trunk", "develop"] as const;

/**
 * The trunk is read from the remote, never assumed.
 *
 * Hardcoding "main" is wrong in every repository that predates the rename, and
 * wrong silently: the push would create a second trunk called main rather than
 * fail.
 */
export async function resolveTrunk(git: Git): Promise<string> {
  const head = await git([
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  const named = head.stdout.trim().replace(/^origin\//, "");
  if (head.code === 0 && named) return named;

  for (const candidate of TRUNK_CANDIDATES) {
    if (await remoteRefExists(git, candidate)) return candidate;
  }

  throw new Error(
    "Cannot tell which branch is the trunk: origin/HEAD is unset and none of " +
      `${TRUNK_CANDIDATES.join(", ")} exist on origin. Fix it with: git remote set-head origin --auto`,
  );
}

export async function currentBranch(git: Git): Promise<string | undefined> {
  const result = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (result.code !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

async function readUpstream(git: Git): Promise<string | undefined> {
  const result = await git([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (result.code !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export async function resolveDestination(
  git: Git,
  override?: ShipOverride,
): Promise<Destination> {
  const trunk = await resolveTrunk(git);
  const branch = await currentBranch(git);

  if (override === "trunk") {
    return { kind: "trunk", ref: trunk, reason: "you asked for the trunk" };
  }
  if (override === "branch") {
    if (!branch) {
      throw new Error(
        "A detached HEAD has no branch to push. Check out a branch, or ship to the trunk.",
      );
    }
    return {
      kind: "branch",
      branch,
      hasUpstream: (await readUpstream(git)) !== undefined,
      reason: "you asked for this branch",
    };
  }

  // A detached HEAD still has a commit worth landing, and the push names HEAD
  // explicitly, so there is nothing here to get wrong.
  if (!branch) {
    return {
      kind: "trunk",
      ref: trunk,
      reason: "a detached HEAD has no branch to push",
    };
  }
  if (branch === trunk) {
    return { kind: "trunk", ref: trunk, reason: `you are on ${trunk}` };
  }

  const upstream = await readUpstream(git);
  if (upstream) {
    return {
      kind: "branch",
      branch,
      hasUpstream: true,
      reason: `${branch} tracks ${upstream}`,
    };
  }
  if (await remoteRefExists(git, branch)) {
    return {
      kind: "branch",
      branch,
      hasUpstream: false,
      reason: `origin/${branch} already exists`,
    };
  }

  return {
    kind: "trunk",
    ref: trunk,
    reason: `${branch} was never pushed, so it is a local worktree branch`,
  };
}

export function describeDestination(destination: Destination): string {
  return destination.kind === "trunk"
    ? `Shipping to origin/${destination.ref} (${destination.reason}).`
    : `Shipping to branch ${destination.branch} (${destination.reason}).`;
}
