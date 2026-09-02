/**
 * To main
 *
 * A kept alias for muscle memory. `/ship` now works out for itself that a
 * worktree branch nobody ever pushed belongs on the trunk, which is every case
 * this command used to exist for, so `/to-main` is `/ship main`: the same run
 * with the inference skipped and the trunk forced.
 *
 * Delete this directory once the fingers have caught up.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shipCommand } from "../ship/index";

export default function toMainExtension(pi: ExtensionAPI) {
  pi.registerCommand("to-main", {
    description: "Alias for /ship main: commit and land on the trunk from any branch",
    handler: (args, ctx) => shipCommand(pi, args, ctx, "/to-main", "trunk"),
  });
}
