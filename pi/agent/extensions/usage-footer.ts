import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type RateLimitWindow = {
	usedPercent: number;
	windowDurationMins: number | null;
	resetsAt: number | null;
};

type RateLimitSnapshot = {
	primary: RateLimitWindow | null;
	secondary: RateLimitWindow | null;
};

type RateLimitsResponse = {
	rateLimits?: RateLimitSnapshot;
};

const CODEX_PROVIDER = "openai-codex";
const CLAUDE_PROVIDERS = new Set(["cliproxyapi", "anthropic"]);
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RPC_BUFFER_BYTES = 1_000_000;
const SEPARATOR = " • ";

function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatWorkTime(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function formatCwd(cwd: string): string {
	const home = homedir();
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const insideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !relativeToHome.startsWith(sep));

	if (!insideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function formatReset(resetsAt: number | null): string | undefined {
	if (resetsAt === null) return undefined;

	const minutes = Math.max(0, Math.ceil((resetsAt * 1_000 - Date.now()) / 60_000));
	if (minutes === 0) return "now";
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours < 48) return remainingMinutes === 0 ? `${hours}h` : `${hours}h${remainingMinutes}m`;

	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours === 0 ? `${days}d` : `${days}d${remainingHours}h`;
}

function selectLongestWindow(snapshot: RateLimitSnapshot | undefined): RateLimitWindow | undefined {
	if (!snapshot) return undefined;
	const windows = [snapshot.primary, snapshot.secondary].filter(
		(window): window is RateLimitWindow => window !== null,
	);

	return windows.sort((a, b) => (b.windowDurationMins ?? 0) - (a.windowDurationMins ?? 0))[0];
}

function readCodexRateLimits(
	onProcess: (process: ChildProcessWithoutNullStreams | undefined) => void,
): Promise<RateLimitWindow | undefined> {
	return new Promise((resolvePromise) => {
		const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		onProcess(child);

		let settled = false;
		let buffer = "";

		const finish = (value: RateLimitWindow | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			onProcess(undefined);
			child.kill();
			resolvePromise(value);
		};

		const send = (message: unknown) => {
			if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
		};

		const timeout = setTimeout(() => finish(undefined), REQUEST_TIMEOUT_MS);

		child.on("error", () => finish(undefined));
		child.on("exit", () => finish(undefined));
		child.stderr.resume();
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			if (Buffer.byteLength(buffer, "utf8") > MAX_RPC_BUFFER_BYTES) {
				finish(undefined);
				return;
			}

			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);

				let message: { id?: number; result?: RateLimitsResponse; error?: unknown };
				try {
					message = JSON.parse(line) as typeof message;
				} catch {
					continue;
				}

				if (message.id === 1 && !message.error) {
					send({ method: "initialized" });
					send({ method: "account/rateLimits/read", id: 2 });
				} else if (message.id === 2) {
					finish(message.error ? undefined : selectLongestWindow(message.result?.rateLimits));
				}
			}
		});

		send({
			method: "initialize",
			id: 1,
			params: {
				clientInfo: {
					name: "pi-usage-footer",
					title: "Pi Usage Footer",
					version: "1.0.0",
				},
				capabilities: null,
			},
		});
	});
}

/**
 * Claude Code OAuth access tokens, most trustworthy first: cliproxy's auth dir
 * (the proxy keeps these refreshed) then pi's own anthropic credentials.
 */
function readClaudeAccessTokens(): string[] {
	const tokens: string[] = [];
	const authDir = process.env.CLI_PROXY_API_AUTH_DIR ?? join(homedir(), ".cli-proxy-api");

	try {
		for (const file of readdirSync(authDir)) {
			if (!file.endsWith(".json")) continue;
			try {
				const data = JSON.parse(readFileSync(join(authDir, file), "utf8")) as {
					type?: string;
					disabled?: boolean;
					access_token?: string;
				};
				if (data.type !== "claude" || data.disabled || !data.access_token) continue;
				tokens.push(data.access_token);
			} catch {
				// Ignore unreadable or malformed credential files.
			}
		}
	} catch {
		// cliproxy auth dir missing.
	}

	try {
		const piAuth = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8")) as Record<
			string,
			{ access?: string } | undefined
		>;
		const access = piAuth.anthropic?.access;
		if (access) tokens.push(access);
	} catch {
		// No pi anthropic credentials.
	}

	return tokens;
}

async function readClaudeFiveHourWindow(): Promise<RateLimitWindow | undefined> {
	for (const token of readClaudeAccessTokens()) {
		try {
			const response = await fetch(CLAUDE_USAGE_URL, {
				headers: {
					authorization: `Bearer ${token}`,
					"anthropic-beta": "oauth-2025-04-20",
					"user-agent": "pi-usage-footer/1.0",
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) continue;

			const payload = (await response.json()) as {
				five_hour?: { utilization?: number; resets_at?: string | null };
			};
			const fiveHour = payload.five_hour;
			if (!fiveHour) continue;

			const resetsAtMs = fiveHour.resets_at ? Date.parse(fiveHour.resets_at) : Number.NaN;
			return {
				usedPercent: fiveHour.utilization ?? 0,
				windowDurationMins: 300,
				resetsAt: Number.isNaN(resetsAtMs) ? null : Math.floor(resetsAtMs / 1_000),
			};
		} catch {
			// Try the next credential.
		}
	}

	return undefined;
}

export default function usageFooter(pi: ExtensionAPI) {
	let limitWindow: RateLimitWindow | undefined;
	let limitLabel = "";
	let limitSource: string | undefined;
	let lastClaudeFetchAt = 0;
	let refreshInFlight: Promise<void> | undefined;
	let activeProcess: ChildProcessWithoutNullStreams | undefined;
	let requestRender: (() => void) | undefined;
	let accumulatedWorkTimeMs = 0;
	let workStartedAt: number | undefined;
	let hasWorkStarted = false;
	let workTimer: ReturnType<typeof setInterval> | undefined;
	let limitTimer: ReturnType<typeof setInterval> | undefined;

	const clearLimitTimer = () => {
		if (limitTimer === undefined) return;
		clearInterval(limitTimer);
		limitTimer = undefined;
	};

	const clearWorkTimer = () => {
		if (workTimer === undefined) return;
		clearInterval(workTimer);
		workTimer = undefined;
	};

	const startWork = () => {
		if (workStartedAt !== undefined) return;
		hasWorkStarted = true;
		workStartedAt = Date.now();
		workTimer = setInterval(() => requestRender?.(), 1_000);
		workTimer.unref();
		requestRender?.();
	};

	const stopWork = () => {
		if (workStartedAt === undefined) return;
		accumulatedWorkTimeMs += Math.max(0, Date.now() - workStartedAt);
		workStartedAt = undefined;
		clearWorkTimer();
		requestRender?.();
	};

	const getWorkTimeMs = () =>
		accumulatedWorkTimeMs + (workStartedAt === undefined ? 0 : Math.max(0, Date.now() - workStartedAt));

	const resetWorkTime = () => {
		clearWorkTimer();
		accumulatedWorkTimeMs = 0;
		workStartedAt = undefined;
		hasWorkStarted = false;
	};

	const refreshRateLimits = (ctx: ExtensionContext) => {
		const provider = ctx.model?.provider;
		if (!provider || refreshInFlight) return;

		if (provider !== limitSource) {
			limitWindow = undefined;
			limitSource = provider;
			lastClaudeFetchAt = 0;
		}

		if (provider === CODEX_PROVIDER) {
			limitLabel = "week ";
			refreshInFlight = readCodexRateLimits((process) => {
				activeProcess = process;
			})
				.then((window) => {
					if (window) limitWindow = window;
				})
				.finally(() => {
					refreshInFlight = undefined;
					requestRender?.();
				});
			return;
		}

		if (!CLAUDE_PROVIDERS.has(provider)) return;
		if (Date.now() - lastClaudeFetchAt < CLAUDE_REFRESH_INTERVAL_MS) return;

		lastClaudeFetchAt = Date.now();
		limitLabel = "";
		refreshInFlight = readClaudeFiveHourWindow()
			.then((window) => {
				if (window) limitWindow = window;
			})
			.finally(() => {
				refreshInFlight = undefined;
				requestRender?.();
			});
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		resetWorkTime();

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribeBranch = footerData.onBranchChange(requestRender);

			// Keep the reset countdown ticking (and the window fresh) while idle.
			clearLimitTimer();
			limitTimer = setInterval(() => {
				refreshRateLimits(ctx);
				requestRender?.();
			}, CLAUDE_REFRESH_INTERVAL_MS);
			limitTimer.unref();

			return {
				dispose() {
					unsubscribeBranch();
					clearWorkTimer();
					clearLimitTimer();
					requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const sessionName = ctx.sessionManager.getSessionName();
					let location = formatCwd(ctx.sessionManager.getCwd());
					if (branch) location += ` (${branch})`;
					if (sessionName) location += ` • ${sessionName}`;

					const context = ctx.getContextUsage();
					const contextTokens = context?.tokens;
					const contextPercent = context?.percent;
					const contextText = `${
						contextTokens === null || contextTokens === undefined ? "?" : formatTokens(contextTokens)
					}${contextPercent === null || contextPercent === undefined ? "" : ` (${Math.round(contextPercent)}%)`}`;
					const coloredContext =
						(contextPercent ?? 0) > 90
							? theme.fg("error", contextText)
							: (contextPercent ?? 0) > 70
								? theme.fg("warning", contextText)
								: contextText;

					const leftParts: string[] = [];
					if (limitWindow) {
						const remaining = Math.max(0, Math.min(100, 100 - limitWindow.usedPercent));
						const reset = formatReset(limitWindow.resetsAt);
						const limitText = `${limitLabel}${remaining.toFixed(0)}% left${reset ? ` ↻${reset}` : ""}`;
						leftParts.push(
							remaining <= 10
								? theme.fg("error", limitText)
								: remaining <= 30
									? theme.fg("warning", limitText)
									: limitText,
						);
					}
					leftParts.push(coloredContext);

					let left = leftParts.join(SEPARATOR);
					const model = ctx.model?.id ?? "no-model";
					const right = ctx.model?.reasoning ? `${model} • ${ctx.thinkingLevel}` : model;
					const rightWidth = visibleWidth(right);
					const availableLeft = Math.max(0, width - rightWidth - 2);
					left = truncateToWidth(left, availableLeft, "…");
					const padding = " ".repeat(Math.max(2, width - visibleWidth(left) - rightWidth));
					const stats = truncateToWidth(left + padding + right, width, "");

					let locationLine: string;
					if (hasWorkStarted) {
						const workTime = `worked ${formatWorkTime(getWorkTimeMs())}`;
						const workTimeWidth = visibleWidth(workTime);
						const availableLocationWidth = width - workTimeWidth - 2;
						if (availableLocationWidth > 0) {
							const visibleLocation = truncateToWidth(location, availableLocationWidth, "…");
							const locationPadding = " ".repeat(
								Math.max(2, width - visibleWidth(visibleLocation) - workTimeWidth),
							);
							locationLine = theme.fg("dim", visibleLocation + locationPadding + workTime);
						} else {
							locationLine = truncateToWidth(theme.fg("dim", location), width, theme.fg("dim", "…"));
						}
					} else {
						locationLine = truncateToWidth(theme.fg("dim", location), width, theme.fg("dim", "…"));
					}

					return [locationLine, theme.fg("dim", stats)];
				},
			};
		});

		refreshRateLimits(ctx);
	});

	pi.on("agent_start", () => {
		startWork();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.isIdle()) stopWork();
		refreshRateLimits(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		requestRender?.();
		refreshRateLimits(ctx);
	});

	pi.on("session_shutdown", () => {
		clearWorkTimer();
		clearLimitTimer();
		activeProcess?.kill();
		activeProcess = undefined;
		requestRender = undefined;
	});
}
