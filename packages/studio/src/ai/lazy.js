/**
 * lazy.js — single dynamic-import shim for @lerret/ai.
 *
 * This is the ONLY file in @lerret/studio that performs `await import('@lerret/ai')`.
 * Every other studio AI surface (setup screen, privacy disclosure, settings panel,
 * dock cluster) reaches the AI subsystem via `const ai = await getAi();`. The
 * module memoizes the resolved module on a module-level variable so the dynamic
 * chunk is fetched at most once per session.
 *
 * The import below is a LITERAL dynamic import on purpose: Vite/Rolldown
 * statically sees the specifier and code-splits @lerret/ai (LangGraph +
 * providers + vault) into its own on-demand chunk, fetched only when an AI
 * surface first touches `getAi()`. The workspace always has @lerret/ai
 * available at build time, and downstream consumers receive the PRE-BUILT
 * dist-studio, so the chunk is always present in shipped artifacts. (A
 * variable-specifier + `@vite-ignore` form would survive the build but emit a
 * native browser `import('@lerret/ai')` of a bare specifier — which can never
 * resolve at runtime without an import map.)
 *
 * The dynamic-import boundary is documented in architecture-epic-8.md §Studio
 * Chrome (AI Glue) and enforced by no-static-imports.test.js (Story 8.0). Adding
 * a static `import … from '@lerret/ai'` anywhere under packages/studio/src/ will
 * fail the workspace test suite. (Literal DYNAMIC imports are explicitly
 * permitted by that guard.)
 *
 * Idle-graceful behavior: when the chunk fails to load (network failure, a
 * downstream build that intentionally stripped the AI feature, a corrupted
 * deploy), the catch below degrades `getAi()` to `null`. Consumers MUST handle
 * that null case by rendering an empty/idle fallback — never throw.
 *
 * The boundary contract:
 *   - INSIDE @lerret/ai (providers, vault, orchestrator): internal static
 *     imports between sibling subsystems are fine.
 *   - OUTSIDE @lerret/ai (studio, cli, core): reach the subsystem only via this
 *     shim (or, in the cli, via its own equivalent shim).
 */

/**
 * Resolved @lerret/ai module, or null when the chunk could not be loaded.
 * Lazily populated on the first successful `getAi()` call.
 *
 * The triple-state allows us to distinguish "not yet attempted" (cachedModule
 * undefined) from "attempted and failed" (cachedModule === null) from
 * "loaded" (cachedModule is the module namespace object).
 *
 * @type {unknown}
 */
let cachedModule;

/**
 * The in-flight import promise, if a `getAi()` call is currently awaiting the
 * dynamic-import. Subsequent concurrent calls share this promise so the chunk
 * is fetched exactly once even under concurrent first-touch.
 *
 * @type {Promise<unknown> | undefined}
 */
let inflight;

/**
 * Resolve the @lerret/ai module, fetching the dynamic chunk on first call and
 * returning the memoized reference on every subsequent call.
 *
 * @returns {Promise<unknown | null>} The @lerret/ai module namespace, or null
 *   when the chunk could not be loaded in the current build.
 */
export async function getAi() {
    if (cachedModule !== undefined) return cachedModule;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            // Literal specifier — Vite/Rolldown code-splits this into a real
            // on-demand chunk (see the file header for why a variable
            // specifier would break the built studio).
            const mod = await import('@lerret/ai');
            cachedModule = mod;
            return mod;
        } catch (err) {
            // The dynamic import can throw when the chunk fails to load
            // (network failure, an intentionally-stripped downstream build,
            // a corrupted deploy). We return null and the caller renders an
            // empty fallback. The error is preserved on the module-level
            // variable so a debugger has it available without forcing every
            // component into a try/catch posture.
            cachedModule = null;
            lastLoadError = err;
            return null;
        } finally {
            inflight = undefined;
        }
    })();

    return inflight;
}

/**
 * The most recent dynamic-import error, if any. Exposed for diagnostic
 * surfaces (the settings panel's "AI not available" empty state can show the
 * underlying reason). Not part of the stable public contract — treat as
 * debug-only.
 *
 * @type {unknown}
 */
export let lastLoadError;

/**
 * Reset the memoized module reference. Test-only — production code MUST NOT
 * call this. Lets test suites reset between specs without having to reload
 * the module file from disk.
 */
export function _resetAiCache() {
    cachedModule = undefined;
    inflight = undefined;
    lastLoadError = undefined;
}
