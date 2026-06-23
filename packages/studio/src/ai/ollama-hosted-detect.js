/**
 * ollama-hosted-detect.js — Story 8.10 hosted-mode probe classifier + gate.
 *
 * Two tiny pure helpers the setup screen uses to decide what happens when the
 * user selects the Ollama card:
 *
 *   - {@link shouldRunHostedProbe} — is the studio in a mode where the
 *     localhost CORS hurdle can exist at all? Only the hosted deployment
 *     (`https://app.lerret.belikely.com` or a self-hosted static build) has it;
 *     CLI mode serves from `http://localhost` and never needs the probe.
 *   - {@link classifyOllamaProbe} — route the provider's `probe()` result to
 *     one of three setup-screen paths: proceed / OLLAMA_ORIGINS guide /
 *     contained error.
 *
 * This module deliberately re-reads the two `globalThis.__LERRET_*` mode
 * flags inline rather than importing `isHostedMode()` / `isCliMode()` from
 * `main.jsx` — `main.jsx` calls `boot()` at import time (a top-level side
 * effect), so importing it from here would mount the studio inside any test
 * that touches this module. The predicates below mirror main.jsx exactly;
 * keep them in sync if the entry layer ever changes the flag names.
 *
 * Timing-disambiguation note (AC-3 tuning seam):
 * The provider's `isLikelyCorsError()` (packages/ai/src/providers/ollama.js)
 * treats any local-host fetch `TypeError` as likely-CORS, because browsers
 * give no structured CORS signal. AC-3 sketches a refinement — a TypeError
 * that rejects after a brief delay → CORS (the server answered, the browser
 * blocked the read); an immediate rejection → not running (connection
 * refused). For v1 we trust the provider's `reason` field as-is and do NOT
 * re-implement fetch timing here; the fail-safe routing below means a
 * misclassified "not running" still lands on the contained-error path, which
 * always carries a docs link to the OLLAMA_ORIGINS fix. If a future tuning
 * story adds the timing heuristic, THIS classifier (not the provider) is the
 * seam: measure the rejection latency around `provider.probe()` in the
 * setup-screen helper and feed the refined reason in here.
 */

/**
 * Mirror of main.jsx `isCliMode()` — the CLI's Vite plugin injects the flag.
 *
 * @returns {boolean}
 */
function isCliMode() {
    return typeof globalThis !== 'undefined' && globalThis.__LERRET_CLI_MODE__ === true;
}

/**
 * Mirror of main.jsx `isHostedMode()` — the static-bundle deployment sets the
 * flag via an inline script in its `index.html`.
 *
 * @returns {boolean}
 */
function isHostedMode() {
    return typeof globalThis !== 'undefined' && globalThis.__LERRET_HOSTED_MODE__ === true;
}

/**
 * Should the Ollama Select path run the hosted probe-and-classify step?
 *
 * True ONLY when hosted mode is active and CLI mode is not (the two flags
 * should never overlap, but if they ever did, CLI wins — no probe, no guide;
 * AC-10). In every other mode the Ollama Select path goes straight to the
 * privacy disclosure, exactly as before Story 8.10.
 *
 * @returns {boolean}
 */
export function shouldRunHostedProbe() {
    return isHostedMode() && !isCliMode();
}

/**
 * Classify the Ollama `probe()` result into a setup-screen route.
 *
 *   - `'ok'`          → proceed (open the Ollama disclosure, then commit)
 *   - `'cors'`        → auto-summon the OLLAMA_ORIGINS guide
 *   - `'unreachable'` → contained error in the setup screen (docs link)
 *
 * Fail-safe: anything not clearly CORS routes to `'unreachable'`, never to
 * the guide. A false-positive guide ("set OLLAMA_ORIGINS") when Ollama simply
 * is not running would be a confusing dead-end; the contained error with a
 * docs link is the safe default.
 *
 * @param {{ ok?: boolean, reason?: string } | null | undefined} result -
 *   The provider's `probe()` resolution (`{ok: true}` or
 *   `{ok: false, reason, detail}`), or anything else on a broken path.
 * @returns {'ok' | 'cors' | 'unreachable'}
 */
export function classifyOllamaProbe(result) {
    if (result && result.ok === true) return 'ok';
    if (result && result.ok === false && result.reason === 'cors') return 'cors';
    return 'unreachable';
}
