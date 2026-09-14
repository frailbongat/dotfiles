/**
 * Everything the bridge asserts about this machine, read from the machine.
 *
 * All IO goes through the `Io` seam so the probe is testable without touching a
 * real filesystem, the same way `ship-git.ts` takes its command runner as an
 * argument.
 */

import { accessSync, constants, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Io = {
	home: string;
	which(command: string): string | null;
	readFile(path: string): string | null;
	readDir(path: string): string[];
	realpath(path: string): string | null;
};

export function systemIo(): Io {
	const path = (process.env.PATH ?? "").split(":").filter(Boolean);
	return {
		home: homedir(),
		which(command) {
			for (const dir of path) {
				const candidate = join(dir, command);
				try {
					accessSync(candidate, constants.X_OK);
					return candidate;
				} catch {
					continue;
				}
			}
			return null;
		},
		readFile(target) {
			try {
				return readFileSync(target, "utf8");
			} catch {
				return null;
			}
		},
		readDir(target) {
			try {
				return readdirSync(target).sort();
			} catch {
				return [];
			}
		},
		realpath(target) {
			try {
				return realpathSync(target);
			} catch {
				return null;
			}
		},
	};
}

/** A shim's playbook mapping is authored knowledge; only its presence is probed. */
const SHIMS = [
	{ name: "watch-pr", replaces: "scripts/watch-pr/watch-pr", playbooks: "babysit and shipping" },
	{ name: "orch", replaces: "scripts/orch/orch.ts", playbooks: "orchestrate" },
	{
		name: "check-plan",
		replaces: "node skills/poteto-mode/scripts/check-plan.mjs",
		playbooks: "multi-phase-plan",
		argument: "<plan.md>",
	},
	{ name: "worktree-audit", replaces: "scripts/worktree-audit.sh", playbooks: "worktree-cleanup" },
] as const;

const PSTACK_PACKAGE = "npm/node_modules/@zenspc/pi-pstack";

export type ShimFact = {
	name: string;
	argument?: string;
	replaces: string;
	playbooks: string;
	path: string | null;
	target: string | null;
	/** False when the shim is still on PATH but an npm update moved the script it execs. */
	targetExists: boolean;
};

export type AgentFact = { name: string; tools: string[] };

export type PlaybookFact = {
	name: string;
	path: string;
	description: string;
	outranks: string | null;
	command: string | null;
};

/**
 * `ambient` means the Paseo desktop app injects the server at launch, so it is
 * present in the cache but in no config file, and absent when pi runs from a
 * plain terminal.
 */
export type McpFact = { name: string; state: "enabled" | "disabled" | "ambient"; tools: string[] };

export type MachineFacts = {
	forge: { gh: string | null; user: string | null; origin: string | null; graphite: string | null };
	bun: string | null;
	shims: ShimFact[];
	agents: AgentFact[];
	mcp: McpFact[];
	pstack: {
		root: string | null;
		version: string | null;
		discoverable: string[];
		hidden: string[];
	};
	sharedSkills: { root: string; shadowed: string[] };
	playbooks: PlaybookFact[];
};

export function parseFrontmatter(text: string): Record<string, string> {
	if (!text.startsWith("---\n")) return {};
	const end = text.indexOf("\n---", 4);
	if (end === -1) return {};
	const fields: Record<string, string> = {};
	for (const line of text.slice(4, end).split("\n")) {
		if (!line.trim() || line.startsWith(" ") || line.startsWith("\t")) continue;
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		if (!key) continue;
		fields[key] = line
			.slice(colon + 1)
			.trim()
			.replace(/^"([\s\S]*)"$/, "$1")
			.replace(/\\"/g, '"');
	}
	return fields;
}

function probeForgeUser(io: Io): string | null {
	const hosts = io.readFile(join(io.home, ".config/gh/hosts.yml"));
	return hosts?.match(/^\s*user:\s*(\S+)\s*$/m)?.[1] ?? null;
}

/**
 * A shim execs the script last, after an optional interpreter that may itself be
 * quoted (`exec "$HOME/.bun/bin/bun" "script" "$@"`), so take the final quoted
 * argument rather than the first.
 */
export function shimTarget(script: string, home: string): string | null {
	const exec = /^\s*exec\s+(.*)$/m.exec(script)?.[1];
	if (!exec) return null;
	const quoted = [...exec.matchAll(/"([^"]*)"/g)].map((match) => match[1]).filter((token) => token !== "$@");
	const target = quoted.at(-1);
	return target ? target.replace(/^\$HOME\b/, home) : null;
}

function probeShims(io: Io): ShimFact[] {
	return SHIMS.map((shim) => {
		const found = io.which(shim.name);
		const script = found ? io.readFile(found) : null;
		const target = script ? shimTarget(script, io.home) : null;
		return {
			...shim,
			path: found?.replace(io.home, "~") ?? null,
			target: target?.replace(io.home, "~") ?? null,
			targetExists: target === null ? found !== null : io.realpath(target) !== null,
		};
	});
}

function probeAgents(io: Io, root: string | null): AgentFact[] {
	if (!root) return [];
	const dir = join(root, "agents");
	return io
		.readDir(dir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const fields = parseFrontmatter(io.readFile(join(dir, file)) ?? "");
			return {
				name: fields.name ?? file.replace(/\.md$/, ""),
				tools: (fields.tools ?? "")
					.split(",")
					.map((tool) => tool.trim())
					.filter(Boolean),
			};
		});
}

function readJson<T>(io: Io, path: string): T | null {
	const raw = io.readFile(path);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function probeMcp(io: Io): McpFact[] {
	const declared =
		readJson<{ mcpServers?: Record<string, { disabled?: boolean }> }>(io, join(io.home, ".config/mcp/mcp.json"))?.mcpServers ?? {};
	const cached =
		readJson<{ servers?: Record<string, { tools?: { name: string }[] }> }>(io, join(io.home, ".pi/agent/mcp-cache.json"))?.servers ?? {};

	const names = [...new Set([...Object.keys(declared), ...Object.keys(cached)])].sort();
	return names.map((name) => {
		const tools = (cached[name]?.tools ?? []).map((tool) => tool.name).sort();
		if (!(name in declared)) return { name, state: "ambient" as const, tools };
		return { name, state: declared[name].disabled ? ("disabled" as const) : ("enabled" as const), tools };
	});
}

function probeSkills(io: Io, root: string | null) {
	if (!root) return { discoverable: [], hidden: [] };
	const dir = join(root, "skills");
	const discoverable: string[] = [];
	const hidden: string[] = [];
	for (const name of io.readDir(dir)) {
		const body = io.readFile(join(dir, name, "SKILL.md"));
		if (body === null) continue;
		const fields = parseFrontmatter(body);
		if (fields["disable-model-invocation"] === "true") hidden.push(name);
		else discoverable.push(name);
	}
	return { discoverable, hidden };
}

function probePlaybooks(io: Io, agentHome: string): PlaybookFact[] {
	const dir = join(agentHome, "pstack/playbooks");
	return io
		.readDir(dir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const path = join(dir, file);
			const fields = parseFrontmatter(io.readFile(path) ?? "");
			return {
				name: fields.name ?? file.replace(/\.md$/, ""),
				path: path.replace(io.home, "~"),
				description: fields.description ?? "",
				outranks: fields.outranks || null,
				command: fields.command || null,
			};
		})
		.filter((playbook) => playbook.description !== "");
}

export function probeFacts(io: Io): MachineFacts {
	const agentHome = join(io.home, ".pi/agent");
	const packageRoot = join(agentHome, PSTACK_PACKAGE);
	const manifest = readJson<{ version?: string }>(io, join(packageRoot, "package.json"));
	const root = manifest === null ? null : packageRoot;
	const sharedRoot = join(io.home, ".agents/skills");
	const skills = probeSkills(io, root);
	const shared = new Set(io.readDir(sharedRoot));

	return {
		forge: {
			gh: io.which("gh"),
			user: probeForgeUser(io),
			origin: io.which("origin"),
			graphite: io.which("gt"),
		},
		bun: io.which("bun")?.replace(io.home, "~") ?? null,
		shims: probeShims(io),
		agents: probeAgents(io, root),
		mcp: probeMcp(io),
		pstack: {
			root: root?.replace(io.home, "~") ?? null,
			version: manifest?.version ?? null,
			discoverable: skills.discoverable,
			hidden: skills.hidden,
		},
		sharedSkills: {
			root: sharedRoot.replace(io.home, "~"),
			shadowed: [...skills.discoverable, ...skills.hidden].filter((name) => shared.has(name)).sort(),
		},
		playbooks: probePlaybooks(io, agentHome),
	};
}
