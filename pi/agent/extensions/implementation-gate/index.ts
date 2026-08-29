import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

type Phase = "idle" | "planning" | "mapped" | "frozen";
type Config = { projects?: Record<string, { fullSuiteCommands?: string[] }> };

const ENTRY_TYPE = "implementation-gate-phase";
const IMPLEMENT_SKILL_PATH = resolve(
  homedir(),
  ".agents/skills/implement/SKILL.md",
);
const config = JSON.parse(
  readFileSync(new URL("./config.json", import.meta.url), "utf8"),
) as Config;
const IMPLEMENT =
  /^\s*(?:\/implement\b|\/skill:implement\b|<skill\s+name=["']implement["'])/i;
const MAP_READY = /^(?:#{1,6}\s*)?Acceptance Map Ready\s*$/im;
const FREEZE_PASSED = /^(?:#{1,6}\s*)?Freeze Gate Passed\s*$/im;
const COMPLETE = /^(?:#{1,6}\s*)?Implementation Complete\s*$/im;
const COMMAND_TOOLS = new Set([
  "bash",
  "ctx_execute",
  "ctx_batch_execute",
  "mcpscript",
]);

export default function implementationGate(pi: ExtensionAPI) {
  let phase: Phase = "idle";

  function transition(next: Phase) {
    if (next === phase) return;
    phase = next;
    pi.appendEntry(ENTRY_TYPE, { phase });
  }

  pi.registerCommand("implement", {
    description: "Implement work using the global implement skill",
    handler: async (args, ctx) => {
      let skillBlock: string;
      try {
        skillBlock = loadImplementSkill();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not load the implement skill: ${message}`, "error");
        return;
      }

      transition("planning");
      const task = args.trim();
      const prompt = task ? `${skillBlock}\n\n${task}` : skillBlock;
      pi.sendUserMessage(
        prompt,
        ctx.isIdle() ? undefined : { deliverAs: "followUp" },
      );
    },
  });

  pi.registerCommand("implementation-gate-reset", {
    description: "Reset an abandoned /implement enforcement session",
    handler: async (_args, ctx) => {
      transition("idle");
      ctx.ui.notify("Implementation gate reset.", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    phase = "idle";
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const restored = readPhase(entry.data);
      if (restored) phase = restored;
    }
  });

  pi.on("input", async (event) => {
    if (IMPLEMENT.test(event.text)) transition("planning");
  });

  pi.on("message_end", async (event) => {
    if (phase === "idle" || event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (COMPLETE.test(text)) transition("idle");
    else if (phase === "planning" && MAP_READY.test(text)) transition("mapped");
    else if (phase === "mapped" && FREEZE_PASSED.test(text))
      transition("frozen");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (phase === "idle") return;
    const tool =
      event.toolName.toLowerCase().split(".").at(-1) ??
      event.toolName.toLowerCase();
    if (tool === "edit" || tool === "write") {
      if (phase === "planning") {
        return {
          block: true,
          reason:
            "Implementation Gate: print `Acceptance Map Ready` before modifying files.",
        };
      }
      if (phase === "frozen") transition("mapped");
      return;
    }
    if (phase !== "frozen" && isConfiguredSuite(tool, event.input, ctx.cwd)) {
      return {
        block: true,
        reason:
          "Implementation Gate: pass and print `Freeze Gate Passed` before the configured full suite.",
      };
    }
  });
}

function loadImplementSkill(): string {
  const content = readFileSync(IMPLEMENT_SKILL_PATH, "utf8");
  const body = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim();
  return `<skill name="implement" location="${IMPLEMENT_SKILL_PATH}">\nReferences are relative to ${dirname(IMPLEMENT_SKILL_PATH)}.\n\n${body}\n</skill>`;
}

function isConfiguredSuite(tool: string, input: unknown, cwd: string): boolean {
  if (!COMMAND_TOOLS.has(tool)) return false;
  const commands = config.projects?.[resolve(cwd)]?.fullSuiteCommands ?? [];
  return stringsIn(input).some((value) =>
    commands.some(
      (command) =>
        value.trim() === command ||
        ["'", '"', "`"].some((quote) =>
          value.includes(`${quote}${command}${quote}`),
        ),
    ),
  );
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringsIn);
}

function readPhase(value: unknown): Phase | null {
  if (!value || typeof value !== "object" || !("phase" in value)) return null;
  const phase = value.phase;
  return phase === "idle" ||
    phase === "planning" ||
    phase === "mapped" ||
    phase === "frozen"
    ? phase
    : null;
}
