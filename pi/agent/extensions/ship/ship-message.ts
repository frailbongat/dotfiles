/**
 * Commit message rules, with no pi runtime behind them.
 *
 * The shape of a message is a decision this repository makes on its own, so it
 * lives where a test can load it without a model provider attached.
 */

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "chore",
  "build",
  "ci",
  "style",
  "revert",
] as const;

export type ValidationResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Model ids that finish a one-line subject in a couple of seconds. Matching on
 * the id keeps this working behind a proxy provider with its own catalogue.
 */
const FAST_MODEL_PATTERNS = [/haiku/i, /flash/i, /mini\b/i, /small\b/i];

/**
 * The fastest model worth handing a diff to, or undefined when the catalogue
 * has none and the caller should keep its own.
 *
 * The last match wins, because catalogues list a family oldest first and the
 * newest small model is the one that still writes a usable subject. Models from
 * the session's own provider are preferred, so a working credential stays
 * working.
 */
export function pickFastModel<T extends { id: string; provider: string }>(
  models: readonly T[],
  activeProvider?: string,
): T | undefined {
  const matches = models.filter((model) =>
    FAST_MODEL_PATTERNS.some((pattern) => pattern.test(model.id)),
  );
  if (matches.length === 0) return undefined;

  const sameProvider = activeProvider
    ? matches.filter((model) => model.provider === activeProvider)
    : [];
  const pool = sameProvider.length > 0 ? sameProvider : matches;
  return pool[pool.length - 1];
}

export function stripOuterCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:text|gitcommit)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export function lineLength(value: string): number {
  return [...value].length;
}

export function validateCommitMessage(raw: string): ValidationResult {
  if (raw.includes("\0"))
    return { ok: false, error: "message contains a NUL byte" };

  const message = stripOuterCodeFence(raw).replace(/\r\n?/g, "\n").trim();
  if (!message) return { ok: false, error: "message is empty" };
  if (message.length > 4_000)
    return { ok: false, error: "message is too long" };

  const lines = message.split("\n");
  const subject = lines[0] ?? "";
  const conventional = new RegExp(
    `^(?:${COMMIT_TYPES.join("|")})(?:\\([A-Za-z0-9._/-]+\\))?!?: .+[^.]$`,
  );

  if (!conventional.test(subject)) {
    return { ok: false, error: "subject is not a valid Conventional Commit" };
  }
  if (lineLength(subject) > 72) {
    return { ok: false, error: "subject exceeds 72 characters" };
  }
  if (lines.length > 1 && lines[1] !== "") {
    return {
      ok: false,
      error: "subject and body must be separated by a blank line",
    };
  }

  for (const [index, line] of lines.entries()) {
    if (lineLength(line) > 72) {
      return { ok: false, error: `line ${index + 1} exceeds 72 characters` };
    }
    if (/\s$/.test(line)) {
      return { ok: false, error: `line ${index + 1} has trailing whitespace` };
    }
  }

  if (/\p{Extended_Pictographic}/u.test(message)) {
    return { ok: false, error: "message contains emoji" };
  }
  if (
    /\b(?:this commit|generated with|co-authored-by|assisted-by)\b/i.test(
      message,
    ) ||
    /(?:\bI\b|\bwe\b|\bnow\b|\bcurrently\b)/i.test(message)
  ) {
    return {
      ok: false,
      error: "message contains prohibited attribution or narration",
    };
  }
  if (lines.slice(2).some((line) => line.startsWith("* "))) {
    return { ok: false, error: "body uses * bullets instead of - bullets" };
  }
  if (/^[^\n]*!:/m.test(subject) && !/^BREAKING CHANGE: .+/m.test(message)) {
    return {
      ok: false,
      error: "breaking commit lacks a BREAKING CHANGE footer",
    };
  }
  if (subject.startsWith("revert") && lines.length < 3) {
    return { ok: false, error: "revert commit lacks an explanatory body" };
  }

  return { ok: true, message };
}

/**
 * Drops a body the message was not entitled to.
 *
 * The model is told to send a subject and nothing else, and it still writes the
 * diff back as bullets often enough that asking again is the wrong fix: a
 * second round trip costs more than the body is worth. So the body is kept only
 * where its absence is a real loss, and thrown away everywhere else. An issue
 * footer written into a body that is about to be dropped moves up into the
 * subject rather than disappearing with it.
 */
export function stripUnneededBody(message: string): string {
  const lines = message.split("\n");
  const subject = lines[0] ?? "";
  if (lines.length < 3) return message;

  const breaking = /!:/.test(subject) || /^BREAKING CHANGE: /m.test(message);
  if (breaking || /^revert\b/i.test(subject)) return message;

  const reference = message
    .slice(subject.length)
    .match(/^(?:Closes|Fixes|Refs) #\d+$/im)?.[0];
  if (!reference) return subject;

  const [verb, number] = reference.split(" ");
  const inline = `${subject} (${verb!.toLowerCase()} ${number})`;
  return lineLength(inline) <= 72 ? inline : `${subject}\n\n${reference}`;
}

/**
 * The reference goes in the subject, because the subject is the whole message
 * in the ordinary case and a lone footer would force a body that says nothing.
 * A message that earned a body gets the footer form instead.
 */
export function addClosingIssue(
  raw: string,
  issueNumber: string,
): ValidationResult {
  const validation = validateCommitMessage(raw);
  if (!validation.ok) return validation;
  if (/#\d+\b/.test(validation.message)) {
    return {
      ok: false,
      error: "generated message already contains an issue reference",
    };
  }

  return validateCommitMessage(
    validation.message.includes("\n")
      ? `${validation.message}\n\nCloses #${issueNumber}`
      : `${validation.message} (closes #${issueNumber})`,
  );
}
