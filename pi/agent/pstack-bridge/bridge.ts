#!/usr/bin/env bun
/**
 * CLI: regenerate `pstack-bridge.md`, or fail when the committed file no longer
 * matches what this machine would produce.
 *
 * `--check` is the point of the whole thing. A bridge that drifts silently is
 * worse than no bridge, because every playbook run inherits the stale claim.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeFacts, systemIo } from "./bridge-facts";
import { renderBridge } from "./bridge-render";

export type DriftHunk = { line: number; committed: string[]; generated: string[] };

export function describeDrift(committed: string, generated: string): DriftHunk[] {
	const left = committed.split("\n");
	const right = generated.split("\n");
	const lcs: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
	for (let i = left.length - 1; i >= 0; i--) {
		for (let j = right.length - 1; j >= 0; j--) {
			lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	const hunks: DriftHunk[] = [];
	let i = 0;
	let j = 0;
	let open: DriftHunk | null = null;
	while (i < left.length || j < right.length) {
		if (i < left.length && j < right.length && left[i] === right[j]) {
			open = null;
			i++;
			j++;
			continue;
		}
		if (!open) {
			open = { line: i + 1, committed: [], generated: [] };
			hunks.push(open);
		}
		if (j >= right.length || (i < left.length && lcs[i + 1][j] >= lcs[i][j + 1])) open.committed.push(left[i++]);
		else open.generated.push(right[j++]);
	}
	return hunks;
}

export function formatDrift(hunks: DriftHunk[]): string {
	return hunks
		.map((hunk) => {
			const lines = [
				...hunk.committed.map((line) => `- ${line}`),
				...hunk.generated.map((line) => `+ ${line}`),
			];
			return `@@ line ${hunk.line}\n${lines.join("\n")}`;
		})
		.join("\n\n");
}

function main(argv: string[]): number {
	const io = systemIo();
	const facts = probeFacts(io);

	if (argv.includes("--facts")) {
		process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
		return 0;
	}

	const target = join(io.home, ".config/pi/agent/pstack-bridge.md");
	const generated = renderBridge(facts);
	const committed = io.readFile(target);

	if (argv.includes("--check")) {
		if (committed === null) {
			process.stderr.write(`pstack-bridge: ${target} is missing. Run pstack-bridge to write it.\n`);
			return 1;
		}
		const hunks = describeDrift(committed, generated);
		if (hunks.length === 0) {
			process.stdout.write(`pstack-bridge: ${target} matches this machine.\n`);
			return 0;
		}
		process.stderr.write(`pstack-bridge: ${target} is stale in ${hunks.length} place${hunks.length === 1 ? "" : "s"}.\n\n`);
		process.stderr.write(`${formatDrift(hunks)}\n\n`);
		process.stderr.write("Run pstack-bridge to regenerate it.\n");
		return 1;
	}

	if (committed === generated) {
		process.stdout.write(`pstack-bridge: ${target} already matches this machine.\n`);
		return 0;
	}
	writeFileSync(target, generated);
	const hunks = committed === null ? [] : describeDrift(committed, generated);
	process.stdout.write(`pstack-bridge: wrote ${target}${hunks.length ? ` (${hunks.length} section${hunks.length === 1 ? "" : "s"} changed)` : ""}.\n`);
	return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
