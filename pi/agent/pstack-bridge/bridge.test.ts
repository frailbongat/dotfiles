import { describe, expect, it } from "bun:test";
import { parseFrontmatter, probeFacts, shimTarget, type Io, type MachineFacts } from "./bridge-facts";
import { renderBridge } from "./bridge-render";
import { describeDrift, formatDrift } from "./bridge";

function fakeIo(files: Record<string, string>, executables: string[] = []): Io {
	const dirs = new Map<string, Set<string>>();
	for (const path of Object.keys(files)) {
		const slash = path.lastIndexOf("/");
		const dir = path.slice(0, slash);
		const add = (parent: string, child: string) => {
			if (!dirs.has(parent)) dirs.set(parent, new Set());
			dirs.get(parent)!.add(child);
		};
		add(dir, path.slice(slash + 1));
		let cursor = dir;
		while (cursor.includes("/")) {
			const cut = cursor.lastIndexOf("/");
			add(cursor.slice(0, cut), cursor.slice(cut + 1));
			cursor = cursor.slice(0, cut);
		}
	}
	return {
		home: "/home/me",
		which: (command) => (executables.includes(command) ? `/usr/bin/${command}` : null),
		readFile: (path) => files[path] ?? null,
		readDir: (path) => [...(dirs.get(path) ?? [])].sort(),
		realpath: (path) => (path in files || dirs.has(path) ? path : null),
	};
}

const PASEO_TOOLS = [
	"create_workspace",
	"create_agent",
	"send_agent_prompt",
	"get_agent_status",
	"get_agent_activity",
	"list_pending_permissions",
	"respond_to_permission",
	"create_schedule",
	"create_heartbeat",
	"list_schedules",
	"inspect_schedule",
	"schedule_logs",
];

const BASE: MachineFacts = {
	forge: { gh: "/usr/bin/gh", user: "frailbongat", origin: null, graphite: null },
	bun: "~/.bun/bin/bun",
	shims: [
		{ name: "watch-pr", replaces: "scripts/watch-pr/watch-pr", playbooks: "babysit and shipping", path: "~/.local/bin/watch-pr", target: "~/pkg/watch-pr", targetExists: true },
	],
	agents: [
		{ name: "poteto-agent", tools: ["read", "grep", "bash", "edit", "write"] },
		{ name: "comment-sicko", tools: ["read", "grep", "bash"] },
	],
	mcp: [
		{ name: "paseo", state: "enabled", tools: PASEO_TOOLS },
		{ name: "playwright", state: "disabled", tools: [] },
	],
	pstack: { root: "~/.pi/agent/npm/node_modules/@zenspc/pi-pstack", version: "0.6.0", discoverable: ["how", "why"], hidden: ["deslop", "arena", "swarm"] },
	sharedSkills: { root: "~/.agents/skills", shadowed: ["unslop"] },
	playbooks: [{ name: "Design", path: "~/.pi/agent/pstack/playbooks/design.md", description: "Visual and interaction design of a frontend surface.", outranks: "Feature and Prototype", command: "/design" }],
};

function withFacts(patch: Partial<MachineFacts>): string {
	return renderBridge({ ...BASE, ...patch });
}

describe("renderBridge reacts to the machine", () => {
	it("tells the agent to skip Origin branches when the CLI is absent", () => {
		expect(withFacts({})).toContain("The `origin` CLI is not installed, so skip every");
	});

	it("stops telling the agent to skip Origin once the CLI appears", () => {
		const bridge = withFacts({ forge: { ...BASE.forge, origin: "/usr/bin/origin" } });
		expect(bridge).toContain("so its playbook branches apply.");
		expect(bridge).not.toContain("skip every Origin branch");
	});

	it("names a missing shim as a blocker instead of listing it as available", () => {
		const bridge = withFacts({ shims: [{ ...BASE.shims[0], path: null }] });
		expect(bridge).toContain("`watch-pr` is MISSING from PATH, so babysit and shipping cannot run the step that needs it.");
	});

	it("calls out a shim whose script an update moved", () => {
		const bridge = withFacts({ shims: [{ ...BASE.shims[0], targetExists: false }] });
		expect(bridge).toContain("is on PATH but execs `~/pkg/watch-pr`, which no longer exists.");
	});

	it("reports the agent tool list it actually read from the agent file", () => {
		expect(withFacts({})).toContain("`poteto-agent` holds read, grep, bash, edit, and write.");
	});

	it("flags a reachable playwright MCP server rather than repeating the disabled note", () => {
		const bridge = withFacts({ mcp: [{ name: "playwright", state: "enabled", tools: [] }] });
		expect(bridge).toContain("is currently reachable, against the standing instruction");
		expect(bridge).not.toContain("do not re-enable it");
	});

	it("warns that an ambient paseo server vanishes outside the desktop app", () => {
		const bridge = withFacts({ mcp: [{ name: "paseo", state: "ambient", tools: PASEO_TOOLS }] });
		expect(bridge).toContain("The Paseo desktop app injects it at launch");
	});

	it("blocks a paseo tool the prose names but the server no longer exposes", () => {
		const tools = PASEO_TOOLS.filter((tool) => tool !== "send_agent_prompt");
		const bridge = withFacts({ mcp: [{ name: "paseo", state: "enabled", tools }] });
		expect(bridge).toContain("`paseo_send_agent_prompt` is named here but absent from the server's tool list.");
	});

	it("wraps a long fact instead of emitting one unreadable line", () => {
		const description = `${"A surface that needs deciding. ".repeat(12)}End.`;
		const bridge = withFacts({ playbooks: [{ ...BASE.playbooks[0], description }] });
		const entry = bridge.split("- **Design.**")[1].split("\n\n")[0];
		const lines = entry.split("\n");
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => line.length <= 100)).toBe(true);
		expect(lines.slice(1).every((line) => line.startsWith("  "))).toBe(true);
	});

	it("replaces the cloud-agent mapping when no paseo server is configured", () => {
		const bridge = withFacts({ mcp: [] });
		expect(bridge).toContain("## Cloud agents have no backend here");
		expect(bridge).not.toContain("paseo_create_workspace");
	});

	it("counts hidden skills from the installed package", () => {
		expect(withFacts({})).toContain("3 of the 5 pstack skills set `disable-model-invocation: true`");
	});

	it("renders a local playbook from its own frontmatter", () => {
		const bridge = withFacts({});
		expect(bridge).toContain("- **Design.** Visual and interaction design of a frontend surface.");
		expect(bridge).toContain("It outranks Feature and Prototype.");
	});

	it("drops the local playbook section when the directory is empty", () => {
		expect(withFacts({ playbooks: [] })).not.toContain("## Local playbooks");
	});
});

describe("shimTarget", () => {
	it("takes the script, not a quoted interpreter that precedes it", () => {
		expect(shimTarget('#!/bin/sh\nexec "$HOME/.bun/bin/bun" "/pkg/orch.ts" "$@"\n', "/home/me")).toBe("/pkg/orch.ts");
	});

	it("reads the three other shim shapes on this machine", () => {
		expect(shimTarget('exec "/pkg/watch-pr" "$@"\n', "/home/me")).toBe("/pkg/watch-pr");
		expect(shimTarget('exec node "/pkg/check-plan.mjs" "$@"\n', "/home/me")).toBe("/pkg/check-plan.mjs");
		expect(shimTarget('exec sh "/pkg/worktree-audit.sh" "$@"\n', "/home/me")).toBe("/pkg/worktree-audit.sh");
	});

	it("expands $HOME so the target can be stat-ed", () => {
		expect(shimTarget('exec "$HOME/pkg/tool" "$@"\n', "/home/me")).toBe("/home/me/pkg/tool");
	});
});

describe("parseFrontmatter", () => {
	it("reads a comma tool list and a quoted description", () => {
		const fields = parseFrontmatter('---\nname: poteto-agent\ndescription: "Routing target: reads poteto-mode."\ntools: read, grep, bash\n---\n\nbody\n');
		expect(fields.name).toBe("poteto-agent");
		expect(fields.description).toBe("Routing target: reads poteto-mode.");
		expect(fields.tools).toBe("read, grep, bash");
	});

	it("returns nothing for a file with no frontmatter", () => {
		expect(parseFrontmatter("### Design\n\nbody\n")).toEqual({});
	});
});

describe("probeFacts", () => {
	const pkg = "/home/me/.pi/agent/npm/node_modules/@zenspc/pi-pstack";
	const io = fakeIo(
		{
			[`${pkg}/package.json`]: '{"version":"0.6.0"}',
			[`${pkg}/agents/poteto-agent.md`]: "---\nname: poteto-agent\ntools: read, bash\n---\n",
			[`${pkg}/skills/how/SKILL.md`]: "---\nname: how\n---\n",
			[`${pkg}/skills/deslop/SKILL.md`]: "---\nname: deslop\ndisable-model-invocation: true\n---\n",
			[`${pkg}/skills/unslop/SKILL.md`]: "---\nname: unslop\n---\n",
			"/home/me/.agents/skills/unslop/SKILL.md": "---\nname: unslop\n---\n",
			"/home/me/.config/gh/hosts.yml": "github.com:\n    users:\n        frailbongat:\n    user: frailbongat\n",
			"/home/me/.config/mcp/mcp.json": '{"mcpServers":{"paseo":{},"playwright":{"disabled":true}}}',
			"/home/me/.pi/agent/pstack/playbooks/design.md": '---\nname: Design\ndescription: "Design a surface."\ncommand: /design\n---\n',
			"/usr/bin/watch-pr": `#!/bin/sh\nexec "${pkg}/skills/poteto-mode/scripts/watch-pr/watch-pr" "$@"\n`,
		},
		["gh", "bun", "watch-pr"],
	);
	const facts = probeFacts(io);

	it("reads the forge account without a network call", () => {
		expect(facts.forge.user).toBe("frailbongat");
		expect(facts.forge.origin).toBeNull();
	});

	it("splits skills by whether the model can invoke them", () => {
		expect(facts.pstack.discoverable).toEqual(["how", "unslop"]);
		expect(facts.pstack.hidden).toEqual(["deslop"]);
	});

	it("finds the skill the shared directory shadows", () => {
		expect(facts.sharedSkills.shadowed).toEqual(["unslop"]);
	});

	it("resolves a shim to the script it execs", () => {
		const watchPr = facts.shims.find((shim) => shim.name === "watch-pr");
		expect(watchPr?.target).toBe("~/.pi/agent/npm/node_modules/@zenspc/pi-pstack/skills/poteto-mode/scripts/watch-pr/watch-pr");
		expect(watchPr?.targetExists).toBe(false);
		expect(facts.shims.find((shim) => shim.name === "orch")?.path).toBeNull();
	});

	it("records MCP servers with their disabled state", () => {
		expect(facts.mcp).toEqual([
			{ name: "paseo", state: "enabled", tools: [] },
			{ name: "playwright", state: "disabled", tools: [] },
		]);
	});

	it("treats a server pi has connected to but nothing declares as ambient", () => {
		const ambient = probeFacts(
			fakeIo({
				"/home/me/.config/mcp/mcp.json": '{"mcpServers":{}}',
				"/home/me/.pi/agent/mcp-cache.json": '{"servers":{"paseo":{"tools":[{"name":"create_agent"}]}}}',
			}),
		);
		expect(ambient.mcp).toEqual([{ name: "paseo", state: "ambient", tools: ["create_agent"] }]);
	});

	it("writes paths relative to home so the bridge is readable", () => {
		expect(facts.pstack.root).toBe("~/.pi/agent/npm/node_modules/@zenspc/pi-pstack");
		expect(facts.playbooks[0].path).toBe("~/.pi/agent/pstack/playbooks/design.md");
	});
});

describe("describeDrift", () => {
	it("finds nothing when the committed file matches", () => {
		expect(describeDrift("a\nb\nc\n", "a\nb\nc\n")).toEqual([]);
	});

	it("reports the replaced line and where it sits", () => {
		const hunks = describeDrift("a\nb\nc\n", "a\nB\nc\n");
		expect(hunks).toEqual([{ line: 2, committed: ["b"], generated: ["B"] }]);
		expect(formatDrift(hunks)).toBe("@@ line 2\n- b\n+ B");
	});

	it("separates two independent changes into two hunks", () => {
		expect(describeDrift("a\nb\nc\nd\n", "a\nB\nc\nD\n").map((hunk) => hunk.line)).toEqual([2, 4]);
	});

	it("reports an inserted line without shifting everything after it", () => {
		expect(describeDrift("a\nc\n", "a\nb\nc\n")).toEqual([{ line: 2, committed: [], generated: ["b"] }]);
	});
});
