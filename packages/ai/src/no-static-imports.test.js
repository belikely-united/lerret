import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The dynamic-import boundary invariant: @lerret/ai is reached ONLY via
 * `await import('@lerret/ai')` from @lerret/studio and @lerret/cli source.
 *
 * Static imports of @lerret/ai from those packages would defeat the boundary —
 * LangGraph + provider code would land in the studio's main chunk, the package
 * could not be cleanly removed, and the future-flex the boundary was extracted
 * for would silently regress.
 *
 * This test scans every source file in core/, studio/, cli/, and create-lerret/
 * and asserts zero static imports of @lerret/ai. Dynamic imports
 * (`await import(...)`) are permitted and expected.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..');

const SCAN_PACKAGES = ['core', 'studio', 'cli', 'create-lerret'];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

const STATIC_IMPORT_PATTERNS = [
    /^\s*import\s+[^;]*?\s+from\s+['"]@lerret\/ai['"]/m,
    /^\s*import\s+['"]@lerret\/ai['"]/m,
    /\brequire\s*\(\s*['"]@lerret\/ai['"]\s*\)/,
];

function walkSource(dir, hits) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        if (name === 'node_modules' || name === 'dist' || name === 'dist-studio') continue;
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
            for (const pattern of STATIC_IMPORT_PATTERNS) {
                if (pattern.test(body)) {
                    hits.push(full);
                    break;
                }
            }
        }
    }
}

describe('@lerret/ai dynamic-import boundary', () => {
    it('no static imports of @lerret/ai in core/, studio/, cli/, create-lerret/', () => {
        const offenders = [];
        for (const pkg of SCAN_PACKAGES) {
            walkSource(join(WORKSPACE_ROOT, pkg, 'src'), offenders);
        }
        expect(
            offenders,
            offenders.length
                ? `Found static imports of @lerret/ai in:\n  ${offenders.join('\n  ')}\n\n` +
                    'Use `await import(\'@lerret/ai\')` instead. The boundary keeps LangGraph + provider ' +
                    'code out of the studio main chunk and lets the package be removed cleanly.'
                : 'boundary clean'
        ).toEqual([]);
    });

    it('captures real static-import patterns when present in a synthetic source string', () => {
        const positives = [
            "import { runTurn } from '@lerret/ai';",
            'import ai from "@lerret/ai";',
            "import '@lerret/ai';",
            "const lib = require('@lerret/ai');",
        ];
        const negatives = [
            "const ai = await import('@lerret/ai');",
            "// import { runTurn } from '@lerret/ai';",
            "import { runTurn } from '@lerret/ai-helpers';",
        ];
        for (const body of positives) {
            const hit = STATIC_IMPORT_PATTERNS.some((p) => p.test(body));
            expect(hit, `expected positive: ${body}`).toBe(true);
        }
        for (const body of negatives) {
            const hit = STATIC_IMPORT_PATTERNS.some((p) => p.test(body));
            expect(hit, `expected negative: ${body}`).toBe(false);
        }
    });
});
