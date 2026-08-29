import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function formatOutput(stdout: string, stderr: string): string {
	return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function updatePi(pi: ExtensionAPI) {
	let updateInProgress = false;

	pi.registerCommand("update", {
		description: "Update Pi and installed packages, then exit",
		handler: async (_args, ctx) => {
			if (updateInProgress) {
				ctx.ui.notify("A Pi update is already in progress.", "warning");
				return;
			}

			updateInProgress = true;
			ctx.ui.notify("Updating Pi and installed packages…", "info");

			try {
				await ctx.waitForIdle();
				const result = await pi.exec("pi", ["update", "--all"]);
				const output = formatOutput(result.stdout, result.stderr);

				if (result.code !== 0 || result.killed) {
					const details = output ? `\n${output}` : "";
					ctx.ui.notify(`Pi update failed (exit ${result.code}).${details}`, "error");
					return;
				}

				const details = output ? `\n${output}` : "";
				ctx.ui.notify(`Pi and package update completed.${details}\nExiting—run pi again to use it.`, "info");
				ctx.shutdown();
			} catch (error) {
				ctx.ui.notify(`Pi update failed: ${formatError(error)}`, "error");
			} finally {
				updateInProgress = false;
			}
		},
	});
}
