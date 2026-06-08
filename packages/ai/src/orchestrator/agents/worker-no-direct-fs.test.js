import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Architecture invariant (architecture-epic-8.md §Pattern Extensions / New
 * Invariants #2): No AI Worker code may call `fs.writeFile`, `fs.deleteFile`,
 * or `fs.mkdir` directly. All write paths go through `core/fs/sandbox.js`.
 * Worker code MUST NOT import from `node:fs`, `node:child_process`, the Node
 * `net` family, or use top-level `fetch(` — the sandbox is the EXCLUSIVE
 * write surface available to the Worker. CI verifies via grep.
 *
 * This test scans every shipped file under
 * `packages/ai/src/orchestrator/agents/` (Worker territory) and asserts none
 * contains a forbidden pattern. The scan list deliberately excludes
 * `packages/ai/src/providers/` and `packages/ai/src/vault/` — those have
 * their own constraints documented in Story 8.1 (providers/ legitimately
 * uses `fetch(`; vault/ uses Web Crypto).
 *
 * Structural sibling of `packages/ai/src/no-static-imports.test.js`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = .../public/packages/ai/src/orchestrator/agents/ ; the scan is
// of `.` (this directory itself).
const SCAN_DIR = __dirname;
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

/**
 * Forbidden patterns. Each is a regex with a label for the failure message.
 * Kept deliberately broad — a false positive is a cheap fix, a missed leak
 * is a broken invariant.
 *
 * @type {{ label: string, pattern: RegExp }[]}
 */
const FORBIDDEN_PATTERNS = [
    // ── Node built-in imports (every spelling) ──────────────────────────────
    {
        label: 'static import of node:fs (any flavour)',
        pattern: /^\s*import\s+[^;]*?\s+from\s+['"]node:fs(?:\/promises)?['"]/m,
    },
    {
        label: 'bare side-effect import of node:fs',
        pattern: /^\s*import\s+['"]node:fs(?:\/promises)?['"]/m,
    },
    {
        label: "static import of bare 'fs'",
        pattern: /^\s*import\s+[^;]*?\s+from\s+['"]fs(?:\/promises)?['"]/m,
    },
    {
        label: "require('node:fs') or require('fs')",
        // Allow whitespace between `require` and `(` — Prettier collapses it
        // but hand-written code may carry it.
        pattern: /\brequire\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/,
    },
    {
        label: "dynamic import('node:fs') or import('fs') (bypass of static-import guard)",
        pattern: /\bimport\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/,
    },
    {
        label: 'static import of node:child_process',
        pattern: /^\s*import\s+[^;]*?\s+from\s+['"]node:child_process['"]/m,
    },
    {
        label: "require('node:child_process') or require('child_process')",
        pattern: /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
    },
    {
        label: "dynamic import('node:child_process') or import('child_process')",
        pattern: /\bimport\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
    },
    {
        label: 'import of node:net / node:dgram / node:http / node:https',
        pattern: /^\s*import\s+[^;]*?\s+from\s+['"]node:(?:net|dgram|http|https)['"]/m,
    },
    {
        label: "require('node:net' / 'node:dgram' / 'node:http' / 'node:https')",
        pattern: /\brequire\s*\(\s*['"]node:(?:net|dgram|http|https)['"]\s*\)/,
    },
    {
        label: "dynamic import('node:net'/'node:dgram'/'node:http'/'node:https')",
        pattern: /\bimport\s*\(\s*['"]node:(?:net|dgram|http|https)['"]\s*\)/,
    },
    // ── Indirect fs access ──────────────────────────────────────────────────
    {
        label: 'direct fs.writeFile / fs.unlink / fs.mkdir / fs.rm call',
        pattern: /\bfs\.(?:writeFile|unlink|mkdir|rm|rmdir|rename|copyFile)\s*\(/,
    },
    {
        label: 'direct child_process.spawn / child_process.exec call (dot OR bracket access)',
        // Catches `child_process.spawn(...)` AND `child_process['spawn'](...)`.
        pattern: /\bchild_process\s*(?:\.(?:spawn|exec|execSync|fork)|\[\s*['"](?:spawn|exec|execSync|fork)['"]\s*\])\s*\(/,
    },
    {
        label: 'process.exec (legacy Node API; dot OR bracket access)',
        pattern: /\bprocess\s*(?:\.exec|\[\s*['"]exec['"]\s*\])\s*\(/,
    },
    // ── Network exfiltration surface ────────────────────────────────────────
    // Note: scoped to agents/ only — providers/ files legitimately call
    // fetch() against vendor endpoints. Worker agents must not.
    {
        label: 'top-level fetch( call',
        pattern: /\bfetch\s*\(/,
    },
    {
        label: 'XMLHttpRequest reference',
        pattern: /\bXMLHttpRequest\b/,
    },
    {
        label: 'WebSocket constructor call',
        pattern: /\bnew\s+WebSocket\s*\(/,
    },
    {
        label: 'direct eval( call',
        pattern: /\beval\s*\(/,
    },
    {
        label: 'indirect eval via alias (const e = eval; or (0, eval)(...))',
        // Catches `const X = eval;` / `let X = eval;` / `var X = eval;` /
        // `something = eval;` AND `(0, eval)(...)`.
        pattern: /(?:\b(?:const|let|var)\s+\w+\s*=\s*eval\b)|(?:\(\s*0\s*,\s*eval\s*\)\s*\()/,
    },
    {
        label: 'Function( (constructor form)',
        pattern: /\bnew\s+Function\s*\(/,
    },
    {
        label: 'globalThis or process.binding bypass',
        pattern: /\b(?:globalThis|process)\s*\.\s*binding\s*\(/,
    },
];

function walkSource(dir, hits) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        // Skip test files — only shipped agent source is scanned.
        if (/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(name)) continue;
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
            for (const { label, pattern } of FORBIDDEN_PATTERNS) {
                if (pattern.test(body)) {
                    hits.push(`${full}: ${label}`);
                }
            }
        }
    }
}

describe('Worker agents — no direct fs / network / shell surface', () => {
    it('no forbidden patterns in any file under packages/ai/src/orchestrator/agents/', () => {
        const offenders = [];
        walkSource(SCAN_DIR, offenders);
        expect(
            offenders,
            offenders.length
                ? `Worker agent files contain forbidden patterns:\n  ${offenders.join(
                      '\n  ',
                  )}\n\n` +
                      'Use the sandbox passed in by createWorker({ sandbox }) for file ops. ' +
                      'Worker code must not import node:fs, node:child_process, node:net/http/https, ' +
                      'must not call fetch() / XMLHttpRequest / WebSocket, and must not use eval() / Function().'
                : 'clean'
        ).toEqual([]);
    });

    it('captures forbidden patterns when present in a synthetic source string', () => {
        // Each entry: [description, synthetic source, expected pattern label substring]
        const positives = [
            ['static import node:fs', "import fs from 'node:fs';", 'node:fs'],
            ['bare side-effect import node:fs', "import 'node:fs';", 'node:fs'],
            ['static import bare fs', "import fs from 'fs';", "bare 'fs'"],
            ['static import node:fs/promises', "import { writeFile } from 'node:fs/promises';", 'node:fs'],
            ['require fs', "const fs = require('node:fs');", "require('node:fs') or require('fs')"],
            ['require fs (whitespace before paren — bypass attempt)', "const fs = require ('node:fs');", "require('node:fs') or require('fs')"],
            ['dynamic import node:fs (bypass via lazy import)', "const fs = await import('node:fs');", 'dynamic import'],
            ['dynamic import node:fs/promises', "const { writeFile } = await import('node:fs/promises');", 'dynamic import'],
            ['static import node:child_process', "import cp from 'node:child_process';", 'node:child_process'],
            ['dynamic import node:child_process', "const cp = await import('node:child_process');", 'dynamic import'],
            ['static import node:net', "import net from 'node:net';", 'node:net'],
            ['static import node:http', "import http from 'node:http';", 'node:http'],
            ['dynamic import node:http', "const http = await import('node:http');", 'dynamic import'],
            ['fs.writeFile call', 'await fs.writeFile(path, data);', 'fs.writeFile'],
            ['fs.unlink call', 'await fs.unlink(path);', 'fs.unlink'],
            ['child_process.spawn call', 'child_process.spawn("ls");', 'child_process.spawn'],
            ['child_process bracket access', "child_process['spawn']('ls');", 'child_process'],
            ['process.exec (legacy)', 'process.exec("ls");', 'process.exec'],
            ['process bracket access', "process['exec']('ls');", 'process.exec'],
            ['top-level fetch', "await fetch('http://evil.example/');", 'fetch'],
            ['XMLHttpRequest reference', 'const xhr = new XMLHttpRequest();', 'XMLHttpRequest'],
            ['new WebSocket', "const ws = new WebSocket('wss://evil/');", 'WebSocket'],
            ['direct eval call', 'eval("alert(1)");', 'direct eval'],
            ['indirect eval via const alias', 'const ev = eval; ev("alert(1)");', 'indirect eval'],
            ['indirect eval via (0, eval) trick', '(0, eval)("alert(1)");', 'indirect eval'],
            ['new Function', "const f = new Function('return 1');", 'Function('],
            ['process.binding bypass', "const fs = process.binding('fs');", 'binding'],
            ['globalThis.binding bypass', "const fs = globalThis.binding('fs');", 'binding'],
        ];
        for (const [name, body, expectedLabelSubstring] of positives) {
            const matched = FORBIDDEN_PATTERNS.find(({ pattern }) => pattern.test(body));
            expect(matched, `expected positive match for: ${name} — "${body}"`).toBeDefined();
            expect(matched.label).toContain(expectedLabelSubstring);
        }

        // Negatives — innocuous look-alikes that must NOT trigger.
        //
        // Note: these grep patterns operate on raw bytes, NOT a JS tokenizer.
        // A comment like `// fs.writeFile(...)` WILL match because the regex
        // can't tell code from comments. That false positive is acceptable —
        // a contributor who literally writes `fs.writeFile(` in a comment can
        // refactor the comment. Hard-coding comment-awareness would bloat the
        // grep guard with little real-world value. So negatives below
        // exclude comment-form lookalikes.
        const negatives = [
            // Line-anchored static-import patterns won't fire on comments
            // because the `^\s*import` anchor requires `import` at line start
            // after optional whitespace; `//` blocks that.
            "// import fs from 'node:fs';",
            // Lookalike identifiers — the boundary word-anchors save us:
            "const fsExistsSync = false;",
            "const fetcher = makeFetcher();",
            // Imports of other packages with substring overlap
            "import { sandbox } from '@lerret/core';",
            // Dynamic-import of @lerret/ai (which is the architectural
            // boundary, not Worker-relevant)
            "const ai = await import('@lerret/ai');",
        ];
        for (const body of negatives) {
            const matched = FORBIDDEN_PATTERNS.find(({ pattern }) => pattern.test(body));
            expect(matched, `expected NO match for innocuous string: "${body}"`).toBeUndefined();
        }
    });
});
