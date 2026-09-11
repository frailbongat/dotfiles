/**
 * Handing the ship report to the Paseo card instead of printing it.
 *
 * Everything ship says goes through `ctx.ui.notify`. In Paseo that lands as a
 * `notification` row, and the `paseo-ship-check` plugin reads the row and
 * publishes a card for the same ship underneath it. No 0.8 API lets a plugin
 * remove or rewrite a row the provider wrote, so the report ends up on the
 * timeline twice: once as a plain line, once as the card.
 *
 * Only the writer can fix that, so the final report is written to a file the
 * plugin reads at the end of the turn. The plugin publishes the card from the
 * file and the line is never printed. A terminal is untouched: the caller only
 * offers the handoff in RPC mode, and every path here refuses unless Paseo
 * itself spawned the process and has the plugin enabled.
 *
 * The handoff is a claim, not a hope. `handOffShipReport` returns `false` for
 * every reason a card would not appear, and a `false` means the caller prints
 * the notice as it always did. A missing Paseo, a disabled plugin, a read-only
 * disk: all of them end with the user reading the report.
 *
 * The file's shape is the contract with `server/ship-handoff.ts` in the plugin,
 * which consumes and deletes it. No pi runtime is touched here, so it unit-
 * tests on its own.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The Paseo plugin that draws the report as a card. */
export const CARD_PLUGIN_ID = "paseo-ship-check";

/** Bumped when the file's shape changes, so an old reader can refuse it. */
export const HANDOFF_VERSION = 1;

export type ShipHandoff = {
  version: number;
  /** The Paseo agent whose timeline the card belongs on. */
  agentId: string;
  /** ISO time the report was written, so a stale file can be dropped. */
  at: string;
  /** The report verbatim, exactly as `ctx.ui.notify` would have printed it. */
  text: string;
};

/** Paseo's state directory, which is where its config and our file live. */
export function paseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PASEO_HOME?.trim();
  return configured ? configured : join(homedir(), ".paseo");
}

/**
 * Whether Paseo's config says the card plugin is loaded.
 *
 * Pure, and deliberately strict: an unreadable or unexpected config is a `no`,
 * because the cost of guessing wrong is a ship the user never sees reported.
 */
export function cardPluginEnabled(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const root = config as { pluginsEnabled?: unknown; plugins?: unknown };
  if (root.pluginsEnabled === false) return false;
  if (!root.plugins || typeof root.plugins !== "object") return false;
  const entry = (root.plugins as Record<string, unknown>)[CARD_PLUGIN_ID];
  if (!entry || typeof entry !== "object") return false;
  return (entry as { enabled?: unknown }).enabled !== false;
}

/**
 * The file this agent's report goes in, or `null` when nothing would read it.
 *
 * `PASEO_AGENT_ID` is set by the daemon on the agent process it spawns, so its
 * absence is how a terminal, a CI run, or a bare `pi` session says the card
 * path is not theirs. The id is a UUID; anything that could walk out of the
 * directory is treated as not being one.
 */
export function handoffPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const agentId = env.PASEO_AGENT_ID?.trim();
  if (!agentId || !/^[A-Za-z0-9._-]+$/.test(agentId)) return null;
  return join(paseoHome(env), "plugin-data", CARD_PLUGIN_ID, `${agentId}.json`);
}

async function pluginIsInstalled(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const raw = await readFile(join(paseoHome(env), "config.json"), "utf8");
    return cardPluginEnabled(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Write the report for the card to publish. `false` means print it instead.
 *
 * The file is replaced, not appended to: a report the plugin never collected
 * belongs to a turn that has scrolled by, and the newest ship is the one worth
 * a card.
 */
export async function handOffShipReport(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const path = handoffPath(env);
  if (!path || !text.trim()) return false;
  if (!(await pluginIsInstalled(env))) return false;

  const handoff: ShipHandoff = {
    version: HANDOFF_VERSION,
    agentId: env.PASEO_AGENT_ID?.trim() ?? "",
    at: new Date().toISOString(),
    text,
  };

  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(handoff)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}
