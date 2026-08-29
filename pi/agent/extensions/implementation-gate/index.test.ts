import { describe, expect, it } from "bun:test";
import implementationGate from "./index";

type Handler = (event: any, context: any) => unknown;
const project = "/Volumes/Dock/dev/frail/zero";

function harness(initialEntries: unknown[] = [], cwd = project) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const entries = [...initialEntries];
  const sentMessages: string[] = [];
  implementationGate({
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (name: string, command: { handler: Handler }) =>
      commands.set(name, command.handler),
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: "custom", customType, data }),
    sendUserMessage: (message: string) => sentMessages.push(message),
  } as never);
  const context = {
    cwd,
    sessionManager: { getEntries: () => entries },
    ui: { notify() {} },
    isIdle: () => true,
  };
  return {
    entries,
    sentMessages,
    emit(event: string, payload: unknown) {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`Missing ${event} handler`);
      return handler(payload, context);
    },
    command(name: string, args = "") {
      const handler = commands.get(name);
      if (!handler) throw new Error(`Missing ${name} command`);
      return handler(args, context);
    },
  };
}

async function activate(gate: ReturnType<typeof harness>) {
  await gate.emit("input", { text: "/implement 54" });
}

async function checkpoint(gate: ReturnType<typeof harness>, text: string) {
  await gate.emit("message_end", {
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("implementation gate extension", () => {
  it("exposes /implement as a direct alias for the skill", async () => {
    const gate = harness();
    await gate.command("implement", "54");

    expect(gate.sentMessages).toHaveLength(1);
    expect(gate.sentMessages[0]).toContain('<skill name="implement"');
    expect(gate.sentMessages[0]).toEndWith("\n\n54");
    expect(
      await gate.emit("tool_call", {
        toolName: "edit",
        input: { path: "src/index.ts" },
      }),
    ).toMatchObject({ block: true });
  });

  it("does not affect ordinary work", async () => {
    const gate = harness();
    expect(
      await gate.emit("tool_call", {
        toolName: "edit",
        input: { path: "README.md" },
      }),
    ).toBeUndefined();
  });

  it("requires the acceptance map before direct edits", async () => {
    const gate = harness();
    await activate(gate);
    expect(
      await gate.emit("tool_call", {
        toolName: "edit",
        input: { path: "src/index.ts" },
      }),
    ).toMatchObject({ block: true });
    await checkpoint(gate, "### Acceptance Map Ready");
    expect(
      await gate.emit("tool_call", {
        toolName: "write",
        input: { path: "src/index.ts" },
      }),
    ).toBeUndefined();
  });

  it("blocks only the configured exact full suite before freeze", async () => {
    const gate = harness();
    await activate(gate);
    await checkpoint(gate, "Acceptance Map Ready");
    expect(
      await gate.emit("tool_call", {
        toolName: "bash",
        input: { command: "bun x vitest run" },
      }),
    ).toMatchObject({ block: true });
    expect(
      await gate.emit("tool_call", {
        toolName: "bash",
        input: { command: "bun x vitest run src/lib/example.test.ts" },
      }),
    ).toBeUndefined();

    const unconfigured = harness([], "/tmp/unconfigured-project");
    await activate(unconfigured);
    await checkpoint(unconfigured, "Acceptance Map Ready");
    expect(
      await unconfigured.emit("tool_call", {
        toolName: "bash",
        input: { command: "bun x vitest run" },
      }),
    ).toBeUndefined();
  });

  it("allows the configured suite after freeze and invalidates freeze after editing", async () => {
    const gate = harness();
    await activate(gate);
    await checkpoint(gate, "Acceptance Map Ready");
    await checkpoint(gate, "Freeze Gate Passed");
    expect(
      await gate.emit("tool_call", {
        toolName: "bash",
        input: { command: "bun x vitest run" },
      }),
    ).toBeUndefined();
    await gate.emit("tool_call", {
      toolName: "functions.edit",
      input: { path: "src/index.ts" },
    });
    expect(
      await gate.emit("tool_call", {
        toolName: "bash",
        input: { command: "bun x vitest run" },
      }),
    ).toMatchObject({ block: true });
  });

  it("restores its phase after session reload", async () => {
    const first = harness();
    await activate(first);
    const restored = harness(first.entries);
    await restored.emit("session_start", { reason: "resume" });
    expect(
      await restored.emit("tool_call", {
        toolName: "write",
        input: { path: "notes.md" },
      }),
    ).toMatchObject({ block: true });
  });

  it("resets manually or through explicit completion", async () => {
    const gate = harness();
    await activate(gate);
    await gate.command("implementation-gate-reset");
    expect(
      await gate.emit("tool_call", {
        toolName: "edit",
        input: { path: "notes.md" },
      }),
    ).toBeUndefined();

    await activate(gate);
    await checkpoint(gate, "Implementation Complete");
    expect(
      await gate.emit("tool_call", {
        toolName: "write",
        input: { path: "notes.md" },
      }),
    ).toBeUndefined();
  });
});
