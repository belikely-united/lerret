/**
 * lazy.js — single dynamic-import shim for @lerret/ai.
 *
 * This is the ONLY file in @lerret/studio that performs `await import('@lerret/ai')`.
 * Every other studio AI surface (setup screen, privacy disclosure, settings panel,
 * dock cluster) reaches the AI subsystem via `const ai = await getAi();`. The
 * module memoizes the resolved module on a module-level variable so the dynamic
 * chunk is fetched at most once per session.
 *
 * The dynamic-import boundary is documented in architecture-epic-8.md §Studio
 * Chrome (AI Glue) and enforced by no-static-imports.test.js (Story 8.0). Adding
 * a static `import … from '@lerret/ai'` anywhere under packages/studio/src/ will
 * fail the workspace test suite.
 *
 * Idle-graceful behavior: @lerret/ai is declared as an `optionalDependency` of
 * @lerret/studio. When the package is not installed (e.g. a downstream consumer
 * intentionally strips the AI feature), `getAi()` resolves to `null`. Consumers
 * MUST handle that null case by rendering an empty/idle fallback — never throw.
 *
 * The boundary contract:
 *   - INSIDE @lerret/ai (providers, vault, orchestrator): internal static
 *     imports between sibling subsystems are fine.
 *   - OUTSIDE @lerret/ai (studio, cli, core): reach the subsystem only via this
 *     shim (or, in the cli, via its own equivalent shim).
 */

/**
 * The bare specifier for the AI package. Stored in a separate constant so the
 * dynamic `import()` call site receives a non-literal (variable) specifier;
 * Vite then defers the resolution to runtime and does NOT fail the build when
 * the optional dependency is absent at compile time.
 *
 * @type {string}
 */
const AI_PACKAGE_SPECIFIER = '@lerret/ai';

/**
 * Resolved @lerret/ai module, or null when the optional package is not
 * installed. Lazily populated on the first successful `getAi()` call.
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
 *   when the optional dependency is not installed in the current build.
 */
export async function getAi() {
    if (cachedModule !== undefined) return cachedModule;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            // Vite statically analyses bare `await import('@lerret/ai')` and
            // refuses to compile when the optional dep is absent at build time.
            // Routing the specifier through a variable + the `@vite-ignore`
            // pragma defers resolution to runtime, which is the correct
            // behaviour for an `optionalDependency`-style dynamic import.
            const specifier = AI_PACKAGE_SPECIFIER;
            const mod = await import(/* @vite-ignore */ specifier);
            cachedModule = mod;
            return mod;
        } catch (err) {
            // The dynamic import can throw for two reasons:
            //   1. The optional dep is not installed (downstream stripped it).
            //   2. A real loader/runtime error (network, syntax, etc.).
            // In either case we return null and the caller renders an empty
            // fallback. The error is preserved on the module-level variable so
            // a debugger has it available without forcing every component into
            // a try/catch posture.
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
