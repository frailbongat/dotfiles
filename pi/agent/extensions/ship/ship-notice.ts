/**
 * Notice text, shaped so it survives whatever renders it.
 *
 * Everything ship says goes through `ctx.ui.notify`, and that lands in two very
 * different places. The TUI prints the string as-is. An RPC client (Paseo) puts
 * it through a Markdown renderer, and Markdown collapses a single newline into
 * a space, so `headline:\n<git log output>` arrives as one run-on line with the
 * commit hashes buried in it.
 *
 * So a notice is built from Markdown blocks rather than lines: blocks are
 * separated by a blank line, and every multi-line body, a list of commits just
 * as much as raw command output, is indented four spaces. That is a code block
 * to Markdown and an obviously quoted block to a terminal, and a code block is
 * the one construct no renderer reflows.
 *
 * Real `-` bullets were tried first and lost. A strict Markdown renderer wants
 * a blank line before a list, and where one is missing it folds every item into
 * the paragraph above, so eight commits arrive as one run-on line with the
 * hashes buried mid-sentence. Indentation has no such precondition.
 *
 * Lists that mean different things get their own labelled section rather than
 * one pile, because `git log HEAD..origin/main` and the same range reversed are
 * indistinguishable once they share a list.
 *
 * No pi runtime behind any of it, same as `ship-git.ts`, so it unit-tests on
 * its own.
 */

/** Past this a list stops informing and starts scrolling. */
const MAX_ITEMS = 8;
/** Roughly one terminal line; longer items are a diff, not a summary. */
const MAX_ITEM_LENGTH = 120;

function truncate(text: string, limit = MAX_ITEM_LENGTH): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function toLines(value: readonly string[] | string): string[] {
  const lines = Array.isArray(value)
    ? [...value]
    : (value as string).split(/\r?\n/);
  return lines.map((line) => line.trim()).filter(Boolean);
}

/**
 * A capped list, indented so a renderer keeps one item per line. The cap is
 * elided rather than dropped, because "and 12 more" is itself the news when a
 * trunk has run far ahead.
 *
 * The `-` stays in front of each item as a literal character inside the block.
 * It costs nothing and it still reads as a list to a human.
 */
export function bulletList(
  value: readonly string[] | string,
  max = MAX_ITEMS,
): string {
  const lines = toLines(value);
  if (lines.length === 0) return "";

  const shown = lines.slice(0, max).map((line) => `- ${truncate(line)}`);
  const hidden = lines.length - max;
  if (hidden > 0) shown.push(`- …and ${hidden} more`);
  return shown.map((line) => `    ${line}`).join("\n");
}

/**
 * Verbatim command output as an indented block: a Markdown code block, and a
 * visibly quoted block anywhere else. Never bulleted, because git output is
 * not a list and wrapping it as one destroys diffs and conflict markers.
 */
export function outputBlock(output: string): string {
  const body = output.replace(/\s+$/, "");
  if (!body) return "";
  return body
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `    ${line}` : ""))
    .join("\n");
}

/**
 * Joins blocks with a blank line, dropping the empty ones.
 *
 * The blank line is the whole point: it is the one separator both a terminal
 * and a Markdown renderer read the same way.
 */
export function joinBlocks(
  ...blocks: (string | undefined | false | null)[]
): string {
  return blocks
    .filter((block): block is string => Boolean(block && block.trim()))
    .map((block) => block.replace(/\s+$/, ""))
    .join("\n\n");
}

/** One named pile of items, for when two piles would otherwise merge. */
export type NoticeSection = {
  /** What this pile is. A trailing colon is added, so leave it off. */
  label: string;
  /** Names, hashes, paths: anything that reads as a list. */
  items?: readonly string[] | string;
  /** Shown in place of the list when there is nothing in it. */
  empty?: string;
};

export type NoticeDetail = {
  /** Names, hashes, paths: anything that reads as a list. */
  items?: readonly string[] | string;
  /** Lists that mean different things, kept apart and named. */
  sections?: readonly NoticeSection[];
  /** Verbatim output from a command that ran. */
  output?: string;
  /** What to do about it, after the evidence. */
  footer?: string;
};

/**
 * A named list: the label on its own line, its items in a block beneath it.
 *
 * The label keeps its colon here, unlike a headline, because the blank line
 * after it already tells both renderers a new block starts. A colon only
 * misleads when a single newline follows it.
 */
export function labelledList(
  { label, items, empty }: NoticeSection,
  max = MAX_ITEMS,
): string {
  const list = items ? bulletList(items, max) : "";
  const body = list || (empty ? `    ${empty}` : "");
  if (!body) return "";
  const head = label.trim().replace(/[:\s]+$/, "");
  return joinBlocks(head ? `${head}:` : "", body);
}

/**
 * A headline sentence, then its evidence.
 *
 * The headline is normalised to end in a period so the blocks below it read as
 * a new thought rather than a continuation. A trailing colon does the opposite:
 * it promises the next thing is on the same line, which is exactly the shape
 * that broke when a renderer collapsed the newline after it.
 */
export function formatNotice(
  headline: string,
  { items, sections, output, footer }: NoticeDetail = {},
): string {
  const head = headline.trim().replace(/[:\s]+$/, "");
  return joinBlocks(
    head && /[.!?…]$/.test(head) ? head : head ? `${head}.` : "",
    items ? bulletList(items) : "",
    ...(sections ?? []).map((section) => labelledList(section)),
    output ? outputBlock(output) : "",
    footer,
  );
}
