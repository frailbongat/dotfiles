/**
 * Registers CLIProxyAPI's custom api id into pi-ai's global API registry.
 *
 * The cliproxyapi provider registers every model under the custom api id
 * `cliproxyapi-codex-responses`, but only as a provider-level `streamSimple`.
 * That makes it reachable through the composed provider
 * (`provider-composer.ts` short-circuits on `model.api === extension.api`)
 * and nowhere else.
 *
 * Anything dispatching on `model.api` through the global registry — that is,
 * `complete()` / `completeSimple()` / `stream()` from `@earendil-works/pi-ai/compat`
 * — instead hits `resolveApiProvider()` and throws:
 *
 *     No API provider registered for api: cliproxyapi-codex-responses
 *
 * Registering the same patched streams globally closes that gap, so one-shot
 * completions from extensions work against cliproxy-served models.
 *
 * This reuses the provider package's own patched module rather than mapping the
 * id onto the builtin `openai-codex-responses`. The patched build carries
 * cliproxy-specific behaviour (WebSocket-only transport, conditional
 * chatgpt-account-id, extra CODEX_TOOL_CALL_PROVIDERS) that the builtin lacks.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerApiProvider, getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCliproxyCodexStreams } from "../npm/node_modules/@router-for-me/pi-cliproxyapi-provider/extensions/codex-stream.ts";

const SOURCE_ID = "cliproxyapi-api-registry";

/**
 * The patched source adds these ids to CODEX_TOOL_CALL_PROVIDERS, so a wrong id
 * silently degrades tool calling. Mirror the provider's own configured id.
 */
function resolveProviderIds(): string[] {
	try {
		const raw = readFileSync(join(homedir(), ".pi", "agent", "cliproxyapi.json"), "utf8");
		const id = (JSON.parse(raw) as { providerId?: string }).providerId?.trim();
		if (id) return [id];
	} catch {
		// Fall through to the package default.
	}
	return ["cliproxyapi"];
}

export default async function registerCliproxyApi(_pi: ExtensionAPI): Promise<void> {
	const streams = await loadCliproxyCodexStreams(resolveProviderIds());

	// The provider extension owns the composed-provider path. Only fill the
	// global registry slot, and never clobber an existing registration.
	if (getApiProvider(streams.api)) return;

	registerApiProvider(
		{
			api: streams.api,
			stream: streams.stream,
			streamSimple: streams.streamSimple,
		},
		SOURCE_ID,
	);
}
