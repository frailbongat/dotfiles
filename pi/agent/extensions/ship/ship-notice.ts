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
 * separated by a blank line, and a blank line is the one separator both a
 * terminal and a Markdown renderer read the same way.
 *
 * Lists are real `-` bullets, not indented text. Indented text renders as a
 * grey code box in an RPC client, which is right for command output and wrong
 * for a list of commits the user is meant to read as prose. The blank line
 * `joinBlocks` puts in front of every block is exactly the precondition a
 * strict renderer wants before a list, so the bullets survive.
 *
 * Verbatim command output is the one thing still boxed, in a fenced block,
 * because a diff or a conflict marker is destroyed by reflowing.
 *
 * A notice never ends on a fenced block. Two notices in a row can arrive as one
 * string, and a trailing block swallows the next message into itself.
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
 * A capped bullet list. The cap is elided rather than dropped, because "and 12
 * more" is itself the news when a trunk has run far ahead.
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
  return shown.join("\n");
}

/**
 * Verbatim command output in a fenced block. Never bulleted, because git output
 * is not a list and wrapping it as one destroys diffs and conflict markers.
 *
 * Fenced rather than indented: an indented block ends at the first line that is
 * not indented, so anything printed after it can be pulled inside. A fence
 * closes itself.
 */
export function outputBlock(output: string): string {
  const body = output.replace(/\s+$/, "");
  if (!body) return "";
  return `\`\`\`\n${body.replace(/`{3,}/g, "'''")}\n\`\`\``;
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
  const body = list || (empty ? empty : "");
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
