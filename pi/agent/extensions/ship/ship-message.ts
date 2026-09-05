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

const EMOJI_PATTERN = /\p{Extended_Pictographic}\uFE0F?/gu;
const SUBJECT_LIMIT = 72;
const CONVENTIONAL_SUBJECT = new RegExp(
  `^(?:${COMMIT_TYPES.join("|")})(?:\\([A-Za-z0-9._/-]+\\))?!?: .+`,
);

/**
 * Greedy word wrap that keeps a bullet's marker on its first line and indents
 * the rest under it. A single word longer than the limit is left alone; nothing
 * can break it, and the caller drops the body rather than shipping a lie.
 */
function wrapLine(line: string, limit: number): string[] {
  if (lineLength(line) <= limit) return [line];

  const prefix = line.match(/^\s*-\s+/)?.[0] ?? "";
  const indent = " ".repeat(lineLength(prefix));
  const words = line.slice(prefix.length).split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = `${prefix}${word}`;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (lineLength(candidate) > limit) {
      wrapped.push(current);
      current = `${indent}${word}`;
      continue;
    }
    current = candidate;
  }

  if (current) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [line];
}

/**
 * Fixes the violations that are typography rather than judgement.
 *
 * A model that writes `* ` for a bullet, forgets the blank line under the
 * subject, ends the subject with a period, or trails a space has not
 * misunderstood the change; it has mistyped the format. Asking it again costs a
 * round trip and usually produces the same class of slip, so these are
 * corrected here and the retry is saved for the things only a model can fix:
 * the wrong type, a narrated body, a subject that says nothing.
 */
export function repairCommitMessage(raw: string): string {
  const normalized = stripOuterCodeFence(raw)
    .replace(/\r\n?/g, "\n")
    .replace(EMOJI_PATTERN, "")
    .trim();
  if (!normalized) return normalized;

  const all = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+$/, ""));

  /* Chatter before the message. A model that opens with "Here is the commit
     message:" has still written a usable one on the next line, and promoting it
     is cheaper and more reliable than asking again. Only ever a promotion: when
     no line is conventional the text is left exactly as it came, so the model
     sees its own words in the retry. */
  const start = all.findIndex((line) => CONVENTIONAL_SUBJECT.test(line));
  const lines = start > 0 ? all.slice(start) : all;

  const subject = (lines[0] ?? "").replace(/\.+$/, "");
  const body = lines.slice(1);

  while (body.length > 0 && body[0] === "") body.shift();
  while (body.length > 0 && body[body.length - 1] === "") body.pop();

  const wrapped = body
    .map((line) => line.replace(/^(\s*)\*\s+/, "$1- "))
    .flatMap((line) => wrapLine(line, SUBJECT_LIMIT));

  return wrapped.length > 0 ? `${subject}\n\n${wrapped.join("\n")}` : subject;
}

/**
 * Drops whole words off the end of an over-long subject, keeping the
 * Conventional Commit prefix and at least one word of summary.
 *
 * Lossy, so it is the last thing tried and the caller says out loud that it
 * happened. A shorter subject the author can amend beats a ship that refuses to
 * happen over thirteen characters.
 */
export function shortenSubject(
  subject: string,
  limit: number = SUBJECT_LIMIT,
): string {
  if (lineLength(subject) <= limit) return subject;

  const prefix = subject.match(/^[^:]+: /)?.[0];
  if (!prefix) return subject;

  const words = subject.slice(prefix.length).split(/\s+/).filter(Boolean);
  const kept: string[] = [];

  for (const word of words) {
    const candidate = `${prefix}${[...kept, word].join(" ")}`;
    if (kept.length > 0 && lineLength(candidate) > limit) break;
    kept.push(word);
  }

  return `${prefix}${kept.join(" ")}`.replace(/[.,;:!?]+$/, "");
}

/**
 * A valid message from one the rules keep rejecting, paid for in words.
 *
 * Two things can still be wrong after a repair: the subject is too long on its
 * own, and the body carries something no wrap can fit. The subject is shortened
 * and the body is dropped, in that order, because the policy is already that
 * most messages have no body at all. A body a breaking change or a revert had
 * to write is never dropped; that failure is real and is reported.
 */
export function forceValidCommitMessage(
  raw: string,
  limit: number = SUBJECT_LIMIT,
): ValidationResult {
  const repaired = repairCommitMessage(raw);
  const lines = repaired.split("\n");
  const subject = shortenSubject(lines[0] ?? "", limit);
  const body = lines.slice(2).join("\n");

  const withBody = validateCommitMessage(body ? `${subject}\n\n${body}` : subject);
  if (withBody.ok) return withBody;

  const bodyIsMandatory =
    /!:/.test(subject) ||
    /^BREAKING CHANGE: /m.test(repaired) ||
    /^revert\b/i.test(subject);

  return bodyIsMandatory ? withBody : validateCommitMessage(subject);
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
  if (lineLength(subject) > SUBJECT_LIMIT) {
    return { ok: false, error: `subject exceeds ${SUBJECT_LIMIT} characters` };
  }
  if (lines.length > 1 && lines[1] !== "") {
    return {
      ok: false,
      error: "subject and body must be separated by a blank line",
    };
  }

  for (const [index, line] of lines.entries()) {
    if (lineLength(line) > SUBJECT_LIMIT) {
      return {
        ok: false,
        error: `line ${index + 1} exceeds ${SUBJECT_LIMIT} characters`,
      };
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
  return lineLength(inline) <= SUBJECT_LIMIT
    ? inline
    : `${subject}\n\n${reference}`;
}

/**
 * The reference goes in the subject, because the subject is the whole message
 * in the ordinary case and a lone footer would force a body that says nothing.
 * A message that earned a body gets the footer form instead, and so does a
 * subject the suffix would push past 72: the model wrote a legal subject, and
 * refusing it over a suffix the caller chose to add is the caller's bug, not
 * the model's. `stripUnneededBody` has made the same choice for as long as it
 * has existed.
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

  const inline = `${validation.message} (closes #${issueNumber})`;
  const fitsInline =
    !validation.message.includes("\n") && lineLength(inline) <= SUBJECT_LIMIT;

  return validateCommitMessage(
    fitsInline ? inline : `${validation.message}\n\nCloses #${issueNumber}`,
  );
}
