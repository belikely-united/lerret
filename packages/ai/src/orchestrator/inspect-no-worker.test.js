// @vitest-environment node
//
// Structural read-only guarantee for INSPECT mode (Story 8.9 AC-11, FR58).
//
// The invariant is STRUCTURAL, not norm-based: an inspect turn must be unable
// to mutate the project even against an adversarial model response. This
// suite pins it from two directions, mirroring the spy + grep discipline of
// ./agents/worker-no-direct-fs.test.js:
//
//   1. RUNTIME: a full inspect turn driven through the real graph against a
//      spy-instrumented in-memory backend calls ZERO mutators (writeFile /
//      deleteFile / mkdir), writes NO snapshot manifest and NO blob (the
//      `.lerret/.state/history` sidecar stays untouched — the revert timeline
//      does not grow), and terminates with `inspector-response` followed by
//      `done { files: [], no turnId }`.
//   2. SOURCE: `agents/inspector.js` contains no Worker import (static,
//      dynamic, or require), no `createWorker` reference, and no sandbox
//      mutator member access — the mutation surface is absent from the
//      inspect module, not merely unused.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTurn } from './run-turn.js';
import * as snapshot from '../snapshot/index.js';
import {
    createInMemoryFs,
    seedFs,
} from '../snapshot/__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';

/** A mock provider handle (same idiom as test/orchestrator.integration.test.js). */
function mockHandle({ name = 'openai', model = 'gpt-4o', onComplete } = {}) {
    return {
        name,
        model,
        modelSupportsVision: () => true,
        complete: onComplete ?? (async () => ({ content: 'the inspect answer' })),
        async *stream() {},
    };
}

/** A mock resolver injected into runTurn so no vault / real provider is hit. */
function mockResolver(active) {
    return {
        async resolveActive() {
            return { handle: active, name: active.name, model: active.model };
        },
        async enumerateVision() {
            return [];
        },
        async resolveOverride() {
            return undefined;
        },
    };
}

/** Drain an async iterable of TurnEvents into an array. */
async function collect(iter) {
    const out = [];
    for await (const ev of iter) out.push(ev);
    return out;
}

/** Wrap the backend's mutators in spies so ANY sandbox mutation is visible. */
function spyMutators(fs) {
    fs.writeFile = vi.fn(fs.writeFile.bind(fs));
    fs.deleteFile = vi.fn(fs.deleteFile.bind(fs));
    fs.mkdir = vi.fn(fs.mkdir.bind(fs));
    return fs;
}

describe('inspect mode — runtime read-only guarantee (AC-11)', () => {
    it('a full inspect turn calls ZERO mutators and leaves the backend byte-empty', async () => {
        const fs = spyMutators(createInMemoryFs());
        const resolver = mockResolver(mockHandle());

        const events = await collect(
            runTurn({
                prompt: 'how many pages does this project have?',
                mode: 'inspect',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        expect(events.some((e) => e.type === 'done')).toBe(true);
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(fs.deleteFile).not.toHaveBeenCalled();
        expect(fs.mkdir).not.toHaveBeenCalled();
        // The strongest claim: NOTHING was persisted at all.
        expect(fs._files.size).toBe(0);
    });

    it('writes NO manifest and NO blob — the revert timeline does not grow', async () => {
        const fs = createInMemoryFs();
        const resolver = mockResolver(mockHandle());

        await collect(
            runTurn({ prompt: 'inspect q', mode: 'inspect', projectRoot: PROJECT_ROOT, fs, resolver }),
        );

        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toEqual([]);
        const historyKeys = [...fs._files.keys()].filter((k) => k.includes('/.state/history/'));
        expect(historyKeys).toEqual([]);
    });

    it('emits inspector-response (with the provider answer) BEFORE done; done has files: [] and NO turnId', async () => {
        const fs = createInMemoryFs();
        const resolver = mockResolver(mockHandle());

        const events = await collect(
            runTurn({ prompt: 'what is here?', mode: 'inspect', projectRoot: PROJECT_ROOT, fs, resolver }),
        );

        const respIdx = events.findIndex((e) => e.type === 'inspector-response');
        const doneIdx = events.findIndex((e) => e.type === 'done');
        expect(respIdx).toBeGreaterThanOrEqual(0);
        expect(doneIdx).toBeGreaterThan(respIdx);
        expect(events[respIdx].answer).toBe('the inspect answer');

        const doneEv = events[doneIdx];
        expect(doneEv.files).toEqual([]);
        expect(doneEv).not.toHaveProperty('turnId');

        // No mutation-progress events of any kind on the inspect path.
        const mutationTypes = ['writing', 'deleting', 'mkdir', 'tool-call'];
        expect(events.filter((e) => mutationTypes.includes(e.type))).toEqual([]);
    });

    it('targeted reads surface as reading{file} events and add ZERO new backend keys', async () => {
        const fs = spyMutators(createInMemoryFs());
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/social/card.jsx`]: 'export const Card = () => null;',
        });
        const before = new Set(fs._files.keys());
        const resolver = mockResolver(mockHandle());

        const events = await collect(
            runTurn({
                prompt: 'explain social/card.jsx',
                mode: 'inspect',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        expect(
            events.some((e) => e.type === 'reading' && e.file === '.lerret/social/card.jsx'),
        ).toBe(true);
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(fs.deleteFile).not.toHaveBeenCalled();
        expect(fs.mkdir).not.toHaveBeenCalled();
        expect([...fs._files.keys()]).toEqual([...before]);
    });

    it('an aborted inspect turn yields stopped with NO turnId — and still writes nothing', async () => {
        const fs = spyMutators(createInMemoryFs());
        const controller = new AbortController();
        const active = mockHandle({
            onComplete: async () => {
                controller.abort(); // Stop pressed mid-round-trip.
                return { content: 'late answer' };
            },
        });
        const resolver = mockResolver(active);

        const events = await collect(
            runTurn({
                prompt: 'stop me',
                mode: 'inspect',
                signal: controller.signal,
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        const stoppedEv = events.find((e) => e.type === 'stopped');
        expect(stoppedEv).toBeDefined();
        expect(stoppedEv).not.toHaveProperty('turnId');
        // The cancelled round-trip's answer is suppressed — no orphan event.
        expect(events.some((e) => e.type === 'inspector-response')).toBe(false);
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(fs._files.size).toBe(0);
        expect(await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs })).toEqual([]);
    });

    it('an errored inspect turn yields error — and still writes nothing (no error-status manifest)', async () => {
        const fs = spyMutators(createInMemoryFs());
        const active = mockHandle({
            onComplete: async () => {
                const err = new Error('rate limited');
                err.name = 'RateLimited';
                throw err;
            },
        });
        const resolver = mockResolver(active);

        const events = await collect(
            runTurn({ prompt: 'boom', mode: 'inspect', projectRoot: PROJECT_ROOT, fs, resolver }),
        );

        const errEv = events.find((e) => e.type === 'error');
        expect(errEv).toBeDefined();
        expect(errEv.error.class).toBe('RateLimited');
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(fs._files.size).toBe(0);
        expect(await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs })).toEqual([]);
    });
});

// ─── Source-level structural guarantee (grep guard, mirrors worker-no-direct-fs) ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INSPECTOR_SOURCE = readFileSync(join(__dirname, 'agents', 'inspector.js'), 'utf8');

/**
 * Forbidden patterns for the Inspector module. A false positive is a cheap
 * fix; a missed mutation surface is a broken FR58 invariant.
 *
 * @type {{ label: string, pattern: RegExp }[]}
 */
const FORBIDDEN_INSPECTOR_PATTERNS = [
    {
        label: 'static import from a worker module',
        pattern: /^\s*import\s+[^;]*?\s+from\s+['"][^'"]*worker[^'"]*['"]/im,
    },
    {
        label: 'bare side-effect import of a worker module',
        pattern: /^\s*import\s+['"][^'"]*worker[^'"]*['"]/im,
    },
    {
        label: 'dynamic import of a worker module',
        // Quote class includes the backtick — `import(`./worker.js`)` is a
        // template-literal bypass of the plain-quote form.
        pattern: /\bimport\s*\(\s*['"`][^'"`]*worker[^'"`]*['"`]/i,
    },
    {
        label: 'require of a worker module',
        pattern: /\brequire\s*\(\s*['"`][^'"`]*worker[^'"`]*['"`]/i,
    },
    {
        label: 'createWorker / createWorkerNode reference',
        pattern: /\bcreateWorker(?:Node)?\b/,
    },
    {
        label: 'sandbox mutator member access (write/delete/mkdir; dot, optional-chaining, OR bracket form)',
        // `\??\.` catches `sandbox?.writeFile` as well as `sandbox.writeFile`.
        pattern: /\bsandbox\s*(?:\??\.\s*(?:writeFile|deleteFile|mkdir)\b|\[\s*['"](?:writeFile|deleteFile|mkdir)['"]\s*\])/,
    },
    {
        label: 'sandbox mutator destructuring ({ writeFile } = sandbox)',
        // A mutator name pulled out of sandbox via destructuring assignment —
        // `const { writeFile } = sandbox` or any brace-list containing one.
        pattern: /\b(?:writeFile|deleteFile|mkdir)\b[^}]*\}\s*=\s*sandbox\b/,
    },
];

describe('inspect mode — source-level structural guarantee', () => {
    it('agents/inspector.js contains no Worker import and no sandbox mutator reference', () => {
        const offenders = FORBIDDEN_INSPECTOR_PATTERNS.filter(({ pattern }) =>
            pattern.test(INSPECTOR_SOURCE),
        ).map(({ label }) => label);
        expect(
            offenders,
            offenders.length
                ? `inspector.js contains forbidden patterns:\n  ${offenders.join('\n  ')}\n\n` +
                      'The Inspector is the read-only complement of the Worker. It must never ' +
                      'import worker.js, reference createWorker, or touch a sandbox mutator — ' +
                      'only the non-mutating readFile / exists pair.'
                : 'clean',
        ).toEqual([]);
        // Sanity: the scan actually read the real module (guards against a
        // path move silently turning the grep into a no-op).
        expect(INSPECTOR_SOURCE).toMatch(/createInspectorNode/);
    });

    it('captures forbidden patterns when present in synthetic source strings (the guard cannot rot)', () => {
        const positives = [
            ["import { createWorker } from './worker.js';", 'static import from a worker module'],
            ["import './worker.js';", 'bare side-effect import of a worker module'],
            ["const w = await import('./worker.js');", 'dynamic import of a worker module'],
            ['const w = await import(`./worker.js`);', 'dynamic import of a worker module'],
            ["const w = require('./worker.js');", 'require of a worker module'],
            ['const w = require(`./worker.js`);', 'require of a worker module'],
            ['createWorker({ sandbox });', 'createWorker / createWorkerNode reference'],
            ['createWorkerNode({ sandbox });', 'createWorker / createWorkerNode reference'],
            ['await sandbox.writeFile(p, c);', 'sandbox mutator member access'],
            ['await sandbox.deleteFile(p);', 'sandbox mutator member access'],
            ['await sandbox.mkdir(p);', 'sandbox mutator member access'],
            ['await sandbox?.writeFile(p, c);', 'sandbox mutator member access'],
            ['await sandbox?.mkdir(p);', 'sandbox mutator member access'],
            ["await sandbox['writeFile'](p, c);", 'sandbox mutator member access'],
            ['const { writeFile } = sandbox;', 'sandbox mutator destructuring'],
            ['const { readFile, deleteFile } = sandbox;', 'sandbox mutator destructuring'],
            ['writeFile } = sandbox', 'sandbox mutator destructuring'],
        ];
        for (const [body, expectedLabelSubstring] of positives) {
            const matched = FORBIDDEN_INSPECTOR_PATTERNS.find(({ pattern }) => pattern.test(body));
            expect(matched, `expected positive match for: "${body}"`).toBeDefined();
            expect(matched.label).toContain(expectedLabelSubstring);
        }

        // Negatives — the read-only surface and innocuous lookalikes must NOT trigger.
        const negatives = [
            'await sandbox.readFile(p);',
            'await sandbox.exists(p);',
            'await sandbox?.readFile(p);', // optional chaining on the READ surface is fine
            'const { readFile, exists } = sandbox;', // destructuring ONLY non-mutators is fine
            "import { thinking, reading, inspectorResponse } from '../events.js';",
            'const networker = makeNetworker();', // 'worker' substring inside an identifier, not a specifier
        ];
        for (const body of negatives) {
            const matched = FORBIDDEN_INSPECTOR_PATTERNS.find(({ pattern }) => pattern.test(body));
            expect(matched, `expected NO match for innocuous string: "${body}"`).toBeUndefined();
        }
    });
});
