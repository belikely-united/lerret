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
];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

/**
 * Identifiers that, if they appear as a *whole-word* argument to a console
 * method, are considered key-material leaks. The regex uses `\b` so that
 * `apiKeyName`, `passwordHash`, `keyId` etc. are NOT flagged (false-positive
 * guard required by the story's Task 5).
 *
 * @type {string[]}
 */
const LEAK_NAMES = ['apiKey', 'key', 'secret', 'token', 'password'];

/**
 * Construct the leak-pattern regex. Matches `console.(log|error|warn|debug)`
 * with any arguments where at least one whole-word match against a name in
 * `LEAK_NAMES` appears before the closing paren. The `[^)]*` allows for
 * argument-list bodies that don't contain a `)` — sufficient for one-line
 * console calls, which is the realistic exfiltration case.
 *
 * Case-insensitive (`/i`) so `console.log(ApiKey)` would also trip.
 *
 * @type {RegExp}
 */
const LEAK_PATTERN = new RegExp(
    `\\bconsole\\.(log|error|warn|debug|info|trace)\\s*\\([^)]*\\b(${LEAK_NAMES.join('|')})\\b[^)]*\\)`,
    'gmi',
);

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
            const lines = body.split('\n');
            for (let i = 0; i < lines.length; i++) {
                // Per-line regex so the violation message can cite exact line.
                const m = lines[i].match(LEAK_PATTERN);
                if (m) {
                    hits.push(`${full}:${i + 1}: ${lines[i].trim()}`);
                }
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
        ];
        const negatives = [
            // False-positive guards required by Task 5: whole-word boundary
            // excludes suffixed identifiers like apiKeyName, passwordHash.
            'console.log(apiKeyName)',
            'console.log(passwordHash)',
            'console.log(keyId)',
            'console.log(tokenType)',
            'console.log(secretShare)',
            // Safe forms — no whole-word match against a leak name.
            'console.log("provider configured")',
            'console.log("ok")',
            'console.log(modelName)',
            // Note: the boolean-coerced form (`!!this.apiKey`) STILL trips —
            // that's intentional. The story's Task 3 guidance is "use a
            // boolean during local debugging, REMOVE before commit"; the CI
            // grep must flag any commit that leaves it in.
        ];
        for (const body of positives) {
            const hit = LEAK_PATTERN.test(body);
            // Reset regex state (LEAK_PATTERN has /g flag).
            LEAK_PATTERN.lastIndex = 0;
            expect(hit, `expected positive: ${body}`).toBe(true);
        }
        for (const body of negatives) {
            LEAK_PATTERN.lastIndex = 0;
            const hit = LEAK_PATTERN.test(body);
            LEAK_PATTERN.lastIndex = 0;
            expect(hit, `expected negative: ${body}`).toBe(false);
        }
    });
});
