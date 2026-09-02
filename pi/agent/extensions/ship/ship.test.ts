import { describe, expect, it } from "bun:test";
import {
  ensureFastForward,
  isStaleRejection,
  pushWithRetry,
  syncLocalTrunk,
} from "./ship-git";
import { resolveDestination, resolveTrunk } from "./ship-destination";
import { parseShipArguments } from "./ship-arguments";
import { resolveGitHubRepository } from "./ship-repository";

function result(stdout: string, code = 0, stderr = "") {
  return {
    stdout,
    stderr,
    code,
    killed: false,
  };
}

/**
 * `rev-parse` answers four different questions in this code, so a test that
 * queues by subcommand alone cannot say which. Keying on the ref makes the
 * repository shape readable instead of positional.
 */
function revParse(refs: Record<string, string>) {
  return (args: string[]) => {
    const ref = args[args.length - 1]!;
    const value = refs[ref];
    return value === undefined ? result("", 1) : result(`${value}\n`);
  };
}

describe("ship repository resolution", () => {
  it("prefers GitHub's canonical repository identity over a renamed origin", async () => {
    const repository = await resolveGitHubRepository(
      async () => result("https://github.com/Project-Lit/litflows-web.git\n"),
      async () => result("Project-Lit/litflows\n"),
    );

    expect(repository).toEqual({
      owner: "Project-Lit",
      repository: "litflows",
    });
  });

  it("falls back to origin when canonical GitHub resolution fails", async () => {
    const repository = await resolveGitHubRepository(
      async () => result("git@github.com:Project-Lit/litflows-web.git\n"),
      async () => result("", 1),
    );

    expect(repository).toEqual({
      owner: "Project-Lit",
      repository: "litflows-web",
    });
  });
});

/**
 * A fake `git` driven by the subcommand, so a test says what the repository
 * looks like rather than which call index returns what.
 */
type Responder =
  | ReturnType<typeof result>[]
  | ((args: string[]) => ReturnType<typeof result>);

function fakeGit(
  responses: Record<string, Responder>,
  calls: string[][] = [],
) {
  return {
    calls,
    git: async (args: string[]) => {
      calls.push(args);
      // `-C <path>` targets another worktree; the subcommand is what matters.
      const rest = args[0] === "-C" ? args.slice(2) : args;
      const responder = responses[rest[0]!];
      if (!responder) return result("", 0);
      if (typeof responder === "function") return responder(rest);
      return responder.length > 1 ? responder.shift()! : responder[0]!;
    },
  };
}

const ranRebase = (calls: string[][]) =>
  calls.some((call) => call[0] === "rebase" && call[1] === "--autostash");

describe("landing fast-forward", () => {
  it("says nothing and rebases nothing when the trunk has not moved", async () => {
    const notices: string[] = [];
    const { git, calls } = fakeGit({
      fetch: [result("")],
      "merge-base": [result("")],
    });

    await ensureFastForward(git, "main", (message) => notices.push(message));

    expect(notices).toEqual([]);
    expect(ranRebase(calls)).toBe(false);
  });

  it("rebases onto a trunk that moved, and names the commit it moved", async () => {
    const notices: string[] = [];
    const { git, calls } = fakeGit({
      fetch: [result("")],
      // Behind first, a descendant once the rebase has replayed HEAD.
      "merge-base": [result("", 1), result("")],
      "rev-parse": [result("deadbee\n")],
      log: [result("431b65a perf(convex): resolve auth without Better Auth bundle\n")],
      rebase: [result("Successfully rebased and updated refs/heads/main.\n")],
    });

    await ensureFastForward(git, "main", (message) => notices.push(message));

    expect(ranRebase(calls)).toBe(true);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("origin/main moved");
    expect(notices[0]).toContain("deadbee");
    expect(notices[0]).toContain("431b65a");
  });

  it("aborts and reports a conflict instead of pushing through it", async () => {
    const { git, calls } = fakeGit({
      fetch: [result("")],
      "merge-base": [result("", 1)],
      "rev-parse": [result("deadbee\n")],
      log: [result("431b65a perf(convex): resolve auth\n")],
      rebase: [
        result("CONFLICT (content): Merge conflict in docs/CONVENTIONS.md\n", 1),
        result(""),
      ],
    });

    await expect(
      ensureFastForward(git, "main", () => {}),
    ).rejects.toThrow(/rebasing onto it failed/);
    expect(
      calls.some((call) => call[0] === "rebase" && call[1] === "--abort"),
    ).toBe(true);
  });

  it("refuses when the fetch itself fails, without touching history", async () => {
    const { git, calls } = fakeGit({
      fetch: [result("fatal: could not read from remote repository\n", 128)],
    });

    await expect(ensureFastForward(git, "main", () => {})).rejects.toThrow(
      /Fetching origin\/main failed/,
    );
    expect(ranRebase(calls)).toBe(false);
  });

  it("refuses when a reported-successful rebase still does not descend", async () => {
    const { git } = fakeGit({
      fetch: [result("")],
      "merge-base": [result("", 1)],
      "rev-parse": [result("deadbee\n")],
      log: [result("431b65a perf(convex): resolve auth\n")],
      rebase: [result("")],
    });

    await expect(ensureFastForward(git, "main", () => {})).rejects.toThrow(
      /still does not descend/,
    );
  });
});

describe("ship arguments", () => {
  it("defaults to inferring the destination", () => {
    expect(parseShipArguments("")).toEqual({
      issueNumber: undefined,
      override: undefined,
    });
  });

  it("reads a destination and an issue in either order", () => {
    expect(parseShipArguments("main 174")).toEqual({
      issueNumber: "174",
      override: "trunk",
    });
    expect(parseShipArguments("174 branch")).toEqual({
      issueNumber: "174",
      override: "branch",
    });
  });

  it("rejects arguments it cannot explain", () => {
    expect(() => parseShipArguments("origin/main")).toThrow(/Unrecognized/);
    expect(() => parseShipArguments("main branch")).toThrow(/conflicting/);
    expect(() => parseShipArguments("0")).toThrow(/Usage/);
  });
});

describe("trunk resolution", () => {
  it("reads the trunk from origin/HEAD rather than assuming main", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("origin/master\n")],
    });

    expect(await resolveTrunk(git)).toBe("master");
  });

  it("falls back to a remote branch that exists when origin/HEAD is unset", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("", 1)],
      "rev-parse": revParse({ "refs/remotes/origin/master": "deadbee" }),
    });

    expect(await resolveTrunk(git)).toBe("master");
  });

  it("refuses to guess when the remote names no trunk at all", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("", 1)],
      "rev-parse": revParse({}),
    });

    await expect(resolveTrunk(git)).rejects.toThrow(/git remote set-head/);
  });
});

describe("destination inference", () => {
  const onTrunk = { "symbolic-ref": [result("origin/main\n"), result("main\n")] };

  it("lands a worktree branch that was never pushed on the trunk", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("origin/main\n"), result("dubai\n")],
      // No upstream, and no origin/dubai.
      "rev-parse": revParse({}),
    });

    expect(await resolveDestination(git)).toEqual({
      kind: "trunk",
      ref: "main",
      reason: "dubai was never pushed, so it is a local worktree branch",
    });
  });

  it("pushes a branch that tracks an upstream, instead of landing it", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("origin/main\n"), result("dubai\n")],
      "rev-parse": revParse({ "@{upstream}": "origin/dubai" }),
    });

    expect(await resolveDestination(git)).toMatchObject({
      kind: "branch",
      branch: "dubai",
      hasUpstream: true,
    });
  });

  it("pushes a branch that exists on origin even with no tracking config", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("origin/main\n"), result("dubai\n")],
      "rev-parse": revParse({ "refs/remotes/origin/dubai": "deadbee" }),
    });

    expect(await resolveDestination(git)).toMatchObject({
      kind: "branch",
      branch: "dubai",
      hasUpstream: false,
    });
  });

  it("lands on the trunk when standing on it", async () => {
    const { git } = fakeGit(onTrunk);

    expect(await resolveDestination(git)).toMatchObject({
      kind: "trunk",
      ref: "main",
    });
  });

  it("lands a detached HEAD on the trunk rather than refusing", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("origin/main\n"), result("", 1)],
    });

    expect(await resolveDestination(git)).toMatchObject({ kind: "trunk" });
  });

  it("honours an explicit override against the inference", async () => {
    const { git } = fakeGit({
      "symbolic-ref": [result("origin/main\n"), result("dubai\n")],
      "rev-parse": revParse({}),
    });

    expect(await resolveDestination(git, "branch")).toMatchObject({
      kind: "branch",
      branch: "dubai",
    });
  });
});

const plan = {
  args: ["origin", "HEAD:main"],
  syncRef: "main",
  label: "The push to origin/main",
};

describe("push retry", () => {
  it("re-syncs and pushes again when a sibling worktree lands first", async () => {
    const notices: string[] = [];
    const { git, calls } = fakeGit({
      "rev-parse": revParse({ "refs/remotes/origin/main": "deadbee" }),
      "merge-base": [result("")],
      push: [
        result("", 1, "! [rejected] main -> main (non-fast-forward)"),
        result("done"),
      ],
    });

    const push = await pushWithRetry(git, plan, (m) => notices.push(m), 1_000);

    expect(push.code).toBe(0);
    expect(calls.filter((call) => call[0] === "push")).toHaveLength(2);
    expect(calls.filter((call) => call[0] === "fetch")).toHaveLength(2);
    expect(notices.some((n) => n.includes("moved again"))).toBe(true);
  });

  it("gives up immediately on a rejection no rebase can fix", async () => {
    const { git, calls } = fakeGit({
      "rev-parse": revParse({ "refs/remotes/origin/main": "deadbee" }),
      "merge-base": [result("")],
      push: [result("", 1, "remote: error: GH006: Protected branch update failed")],
    });

    const push = await pushWithRetry(git, plan, () => {}, 1_000);

    expect(push.code).toBe(1);
    expect(calls.filter((call) => call[0] === "push")).toHaveLength(1);
  });

  it("skips the sync for a branch that has no remote counterpart yet", async () => {
    const { git, calls } = fakeGit({
      "rev-parse": revParse({}),
      push: [result("done")],
    });

    await pushWithRetry(
      git,
      { args: ["--set-upstream", "origin", "dubai"], syncRef: "dubai", label: "x" },
      () => {},
      1_000,
    );

    expect(calls.some((call) => call[0] === "fetch")).toBe(false);
  });

  it("classifies rejections", () => {
    expect(isStaleRejection(result("", 1, "Updates were rejected because"))).toBe(true);
    expect(isStaleRejection(result("", 1, "protected branch hook declined"))).toBe(false);
    expect(isStaleRejection(result("", 0))).toBe(false);
  });
});

describe("local trunk sync", () => {
  const refs = {
    "refs/heads/main": "aaaaaaa",
    "refs/remotes/origin/main": "bbbbbbb",
  };

  it("fast-forwards the ref when no worktree has the trunk checked out", async () => {
    const notices: string[] = [];
    const { git, calls } = fakeGit({
      "rev-parse": revParse(refs),
      "merge-base": [result("")],
      worktree: [result("worktree /repo\nbranch refs/heads/dubai\n")],
    });

    await syncLocalTrunk(git, "main", (m) => notices.push(m));

    expect(
      calls.find((call) => call[0] === "update-ref"),
    ).toEqual(["update-ref", "refs/heads/main", "bbbbbbb", "aaaaaaa"]);
    expect(notices[0]).toContain("Fast-forwarded local main");
  });

  it("fast-forwards a clean checkout in the worktree that holds the trunk", async () => {
    const { git, calls } = fakeGit({
      "rev-parse": revParse(refs),
      "merge-base": [result("")],
      worktree: [result("worktree /repo\nbranch refs/heads/main\n")],
      status: [result("")],
      merge: [result("Updating aaaaaaa..bbbbbbb\n")],
    });

    await syncLocalTrunk(git, "main", () => {});

    expect(calls).toContainEqual(["-C", "/repo", "merge", "--ff-only", "origin/main"]);
  });

  it("never touches a checkout with uncommitted work in it", async () => {
    const notices: string[] = [];
    const { git, calls } = fakeGit({
      "rev-parse": revParse(refs),
      "merge-base": [result("")],
      worktree: [result("worktree /repo\nbranch refs/heads/main\n")],
      status: [result(" M src/app.tsx\n")],
    });

    await syncLocalTrunk(git, "main", (m) => notices.push(m));

    expect(calls.some((call) => call.includes("merge"))).toBe(false);
    expect(notices[0]).toContain("uncommitted changes");
  });

  it("leaves a diverged local trunk alone", async () => {
    const notices: string[] = [];
    const { git, calls } = fakeGit({
      "rev-parse": revParse(refs),
      "merge-base": [result("", 1)],
    });

    await syncLocalTrunk(git, "main", (m) => notices.push(m));

    expect(calls.some((call) => call[0] === "update-ref")).toBe(false);
    expect(notices[0]).toContain("diverged");
  });
});
