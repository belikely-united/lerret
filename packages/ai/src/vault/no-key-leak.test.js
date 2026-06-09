// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Architecture invariant (architecture-epic-8.md §Pattern Extensions / New
 * Invariants #3 — key vault locality): no `console.log` / `console.error` /
 * `console.warn` / `console.debug` invocation in any file under
 * `packages/ai/src/providers/` or `packages/ai/src/vault/` may reference a
 * variable literally named `apiKey`, `key`, `secret`, `token`, or `password`.
 *
 * The plaintext API key NEVER leaves the WebCrypto subtle interface except
 * for the moment a provider constructs its `Authorization` header, and even
 * there the reference is immediately consumed and discarded. Logging it
 * (even for debugging) would render the encryption pointless.
 *
 * This test is the CI grep guard. It mirrors the structure of
 * `packages/ai/src/no-static-imports.test.js` and
 * `packages/ai/src/orchestrator/agents/worker-no-direct-fs.test.js` —
 * walk the directory, regex-scan each file, fail with a clear violation
 * message listing offending lines.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = .../packages/ai/src/vault/ ; go up one to reach .../packages/ai/src/
const SRC_ROOT = join(__dirname, '..');
const SCAN_DIRS = [
    join(SRC_ROOT, 'providers'),
    join(SRC_ROOT, 'vault'),
    // Story 8.3: the orchestrator's run-turn.js now decrypts the API key
    // (binds it to `apiKey`) before handing it to the provider's configure().
    // Scan orchestrator/ too so a `console.log(apiKey)` slip in the
    // provider-handle resolution (or any orchestrator file) fails CI.
    join(SRC_ROOT, 'orchestrator'),
];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

/**
 * Identifiers that, if they appear as a *whole-word* argument to a logging
 * sink, are considered key-material leaks. The regex uses `\b` so that
 * `apiKeyName`, `passwordHash`, `keyId` etc. are NOT flagged (false-positive
 * guard required by the story's Task 5).
 *
 * Includes `_apiKey` (the long-lived private field each cloud provider stores
 * the key on) and `plaintext` / `decrypted` / `plain` / `unwrapped` (the names
 * the vault's `decrypt()` return value is conventionally bound to) — surfaced
 * by the Story 8.1 code review as realistic leak-variable names the original
 * list missed.
 *
 * @type {string[]}
 */
const LEAK_NAMES = [
    'apiKey',
    '_apiKey',
    'key',
    'secret',
    'token',
    'password',
    'plaintext',
    'decrypted',
    'plain',
    'unwrapped',
];

/**
 * Logging sinks scanned for key-material arguments. Beyond `console.*` we also
 * catch `logger.*` (a common alternative). Note this guard is a tripwire for
 * the naive/accidental case, NOT a complete information-flow analysis: it does
 * not catch aliasing (`const k = apiKey; console.log(k)`), arbitrary sinks
 * (`throw new Error(apiKey)`, `el.textContent = apiKey`), or `JSON.stringify`
 * of an object holding the key. Those remain the author's responsibility; this
 * test exists to catch the obvious `console.log(apiKey)` slip in CI.
 *
 * @type {string}
 */
const SINK = '(?:console|logger)\\.(?:log|error|warn|debug|info|trace)';

/**
 * Whole-file (multi-line) leak pattern. `[\\s\\S]*?` (non-greedy any-char
 * INCLUDING newlines) lets the scan catch a leak split across lines, e.g.
 * `console.log(\n  apiKey\n)` — which a per-line scan misses. Case-insensitive
 * so `console.log(ApiKey)` also trips.
 *
 * @type {RegExp}
 */
const LEAK_PATTERN = new RegExp(
    `\\b${SINK}\\s*\\([\\s\\S]*?\\b(${LEAK_NAMES.join('|')})\\b[\\s\\S]*?\\)`,
    'gi',
);

/**
 * Compute the 1-based line number of a character offset within a source body.
 *
 * @param {string} body
 * @param {number} index
 * @returns {number}
 */
function lineAtIndex(body, index) {
    let line = 1;
    for (let i = 0; i < index && i < body.length; i++) {
        if (body[i] === '\n') line++;
    }
    return line;
}

function walkSource(dir, hits) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        // Directory may not yet exist in this worktree (e.g., providers/ is
        // populated by a sibling agent). Skip silently — when both agents'
        // outputs are stitched, the missing dir will be present and the
        // scan will pick it up.
        return;
    }
    for (const name of entries) {
        // Skip test files + helper dirs — they may legitimately reference
        // these identifiers in test fixtures or assertions.
        if (/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(name)) continue;
        if (name === '__test-helpers__') continue;
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            walkSource(full, hits);
        } else {
            const dot = name.lastIndexOf('.');
            const ext = dot === -1 ? '' : name.slice(dot);
            if (!EXTENSIONS.has(ext)) continue;
            const body = readFileSync(full, 'utf8');
            // Whole-file scan (multi-line aware), citing the line of each match.
            LEAK_PATTERN.lastIndex = 0;
            let m;
            while ((m = LEAK_PATTERN.exec(body)) !== null) {
                const lineNo = lineAtIndex(body, m.index);
                hits.push(`${full}:${lineNo}: ${m[0].replace(/\s+/g, ' ').slice(0, 120)}`);
            }
        }
    }
}

describe('@lerret/ai key-material leak guard', () => {
    it('no console.* invocation references apiKey/key/secret/token/password in providers/ or vault/', () => {
        const offenders = [];
        for (const dir of SCAN_DIRS) {
            walkSource(dir, offenders);
        }
        expect(
            offenders,
            offenders.length
                ? `Found console.* invocations referencing key-material identifiers:\n  ${offenders.join(
                      '\n  ',
                  )}\n\n` +
                      'The decrypted key must NEVER appear in logs. Replace with a boolean ' +
                      '(e.g., console.log("configured", !!this.apiKey)) and remove before commit.'
                : 'no leaks'
        ).toEqual([]);
    });

    it('captures real leak patterns when present in a synthetic source string', () => {
        const positives = [
            'console.log(apiKey);',
            'console.error("bad key:", apiKey);',
            'console.warn(key);',
            "console.debug('secret =', secret);",
            'console.log(token + "!")',
            'console.info(password)',
            // case-insensitivity
            'console.log(ApiKey)',
            // multiple args
            'console.log("provider:", name, "apiKey:", apiKey)',
            // NEW (code-review breadth): the private provider field, the
            // decrypt-return binding names, and the logger.* sink.
            'console.log(this._apiKey)',
            'console.log(plaintext)',
            'console.debug(decrypted)',
            'logger.info(apiKey)',
            // NEW: multi-line console call (per-line scan missed this).
            'console.log(\n    apiKey,\n)',
        ];
        const negatives = [
            // False-positive guards required by Task 5: whole-word boundary
            // excludes suffixed identifiers like apiKeyName, passwordHash.
            'console.log(apiKeyName)',
            'console.log(passwordHash)',
            'console.log(keyId)',
            'console.log(tokenType)',
            'console.log(secretShare)',
            'console.log(plaintextLength)',
            // Safe forms — no whole-word match against a leak name.
            'console.log("provider configured")',
            'console.log("ok")',
            'console.log(modelName)',
            // The boolean-coerced form (`!!this.apiKey`) DOES still trip — that
            // is intentional (the story's Task 3 guidance is "use a boolean
            // while debugging, REMOVE before commit"), so it is NOT a negative.
        ];
        for (const body of positives) {
            LEAK_PATTERN.lastIndex = 0;
            const hit = LEAK_PATTERN.test(body);
            LEAK_PATTERN.lastIndex = 0;
            expect(hit, `expected positive: ${JSON.stringify(body)}`).toBe(true);
        }
        for (const body of negatives) {
            LEAK_PATTERN.lastIndex = 0;
            const hit = LEAK_PATTERN.test(body);
            LEAK_PATTERN.lastIndex = 0;
            expect(hit, `expected negative: ${JSON.stringify(body)}`).toBe(false);
        }
    });
});
