/**
 * Argument parsing, kept away from the extension host so the tests can import
 * it without loading a model provider.
 */
import type { ShipOverride } from "./ship-destination";

export interface ShipArguments {
  readonly issueNumber?: string;
  readonly override?: ShipOverride;
  /** Run the formatters and linters even if the agent already ran them clean. */
  readonly recheck?: boolean;
}

const TRUNK_WORDS = new Set(["main", "trunk", "master"]);
const BRANCH_WORDS = new Set(["branch", "here"]);
const RECHECK_WORDS = new Set(["recheck", "check", "checks"]);

/**
 * Tokens in any order, because there is no reason to remember an order for two
 * of them. `/ship`, `/ship 174`, `/ship main`, `/ship main 174` all parse.
 *
 * `main` is a keyword meaning "the trunk", not a branch name. On a repository
 * whose trunk is `master`, `/ship main` still lands on `master`, because the
 * destination is resolved from `origin/HEAD` either way.
 */
export function parseShipArguments(
  raw: string,
  command = "/ship",
): ShipArguments {
  const usage = `Usage: ${command} [main|branch] [recheck] [issue-number] (example: ${command} main 174)`;
  let issueNumber: string | undefined;
  let override: ShipOverride | undefined;
  let recheck = false;

  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const word = token.toLowerCase();

    if (/^\d+$/.test(word)) {
      if (issueNumber) throw new Error(`Two issue numbers given. ${usage}`);
      if (!/^[1-9]\d*$/.test(word) || !Number.isSafeInteger(Number(word))) {
        throw new Error(usage);
      }
      issueNumber = word;
      continue;
    }

    if (RECHECK_WORDS.has(word)) {
      recheck = true;
      continue;
    }

    const parsed = TRUNK_WORDS.has(word)
      ? "trunk"
      : BRANCH_WORDS.has(word)
        ? "branch"
        : undefined;
    if (!parsed) throw new Error(`Unrecognized argument "${token}". ${usage}`);
    if (override && override !== parsed) {
      throw new Error(`Two conflicting destinations given. ${usage}`);
    }
    override = parsed;
  }

  return { issueNumber, override, recheck };
}

/** Kept for callers that only ever passed an issue number. */
export function parseIssueNumberArgument(
  raw: string,
  command = "/ship",
): string | undefined {
  return parseShipArguments(raw, command).issueNumber;
}
