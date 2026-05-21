// Core-purity invariant test — the automated guard for the separation
// invariant (architecture AR2 / AR3, NFR13).
//
// `@lerret/core` is environment-agnostic shared logic: it must run unchanged
// in the browser studio and in the Node CLI. That holds only if `core` itself
// reaches for NEITHER Node built-ins NOR DOM APIs. This test scans every
// source file under `packages/core/src/` and fails if any of them reference a
// forbidden symbol — so a drift is caught in CI, not in production.
//
// Reading the `core` source tree is a test-time concern, so this test file
// (which is not shipped) may use `node:fs` / `node:path`; the files it scans
// are what must stay pure.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const CORE_SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Recursively collect every `.js` / `.jsx` source file under a directory,
 * skipping test files (`*.test.js`, `*.spec.js`) — tests are allowed Node
 * built-ins, only shipped source must be pure.
 *
 * @param {string} dir
 * @returns {string[]} Absolute file paths.
 */
function collectSourceFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (
      /\.(js|jsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(js|jsx)$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Forbidden patterns. Each is a regex plus a label for the failure message.
 * Kept deliberately broad — a false positive is a cheap fix, a missed leak is
 * a broken deploy mode.
 *
 * @type {{ label: string, pattern: RegExp }[]}
 */
const FORBIDDEN = [
  // Node built-in imports, in every spelling.
  { label: "the `node:` import prefix", pattern: /['"]node:[a-z/]+['"]/ },
  {
    label: 'a CommonJS require() of a Node built-in',
    pattern: /\brequire\(\s*['"](fs|path|os|crypto|util|stream|child_process)/,
  },
  {
    label: 'a bare `fs` / `path` import',
    pattern: /\bfrom\s+['"](fs|path|fs\/promises)['"]/,
  },
  // DOM globals — the File System Access API and document/window surface.
  {
    label: 'a DOM global (window / document / navigator)',
    pattern: /\b(window|document|navigator)\s*\./,
  },
  {
    label: 'the File System Access API (showDirectoryPicker)',
    pattern: /showDirectoryPicker|showOpenFilePicker|showSaveFilePicker/,
  },
];

describe('core purity invariant', () => {
  const sourceFiles = collectSourceFiles(CORE_SRC);

  it('finds at least one core source file to scan', () => {
    // A sanity check: if the glob ever silently matches nothing, the suite
    // below would vacuously pass. This guarantees the guard has teeth.
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('contains no Node built-in or DOM references in any core source file', () => {
    /** @type {string[]} */
    const violations = [];

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf-8');
      // Strip line + block comments so a comment that merely *mentions*
      // `node:fs` (this codebase's own docs do) is not a false positive —
      // only real code is checked.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      for (const { label, pattern } of FORBIDDEN) {
        if (pattern.test(code)) {
          const relative = file.slice(CORE_SRC.length + 1);
          violations.push(`${relative}: references ${label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
