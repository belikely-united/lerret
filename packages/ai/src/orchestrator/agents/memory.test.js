// @vitest-environment node
//
// Unit tests for the Memory node — reads the reserved `.lerret/` context files
// and assembles the `context` string. Pins the graceful-absence contract
// Story 8.6 must not break: a missing file contributes nothing (never an
// error), an existing-but-unreadable file is skipped, an empty file emits no
// `reading` event, and present files are joined in RESERVED_CONTEXT_PATHS order.

import { describe, it, expect, vi } from 'vitest';

import { createMemoryNode, RESERVED_CONTEXT_PATHS, BRAND_DIR } from './memory.js';

const DS = '.lerret/_design-system.md';
const CTX = '.lerret/_context.md';
const MEM = '.lerret/_memory.md';

/** Sandbox over a relPath→contents map; absent path → exists:false + read throws. */
function makeSandbox(files = {}) {
    return {
        exists: vi.fn(async (p) => Object.prototype.hasOwnProperty.call(files, p)),
        readFile: vi.fn(async (p) => {
            if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error(`ENOENT ${p}`);
            return files[p];
        }),
    };
}

describe('Memory node — reserved paths', () => {
    it('exports the three reserved paths in injection order + the brand dir', () => {
        expect(RESERVED_CONTEXT_PATHS).toEqual([DS, CTX, MEM]);
        expect(BRAND_DIR).toBe('.lerret/_brand');
    });
});

describe('createMemoryNode — graceful absence', () => {
    it('no files → empty context, no reading events, no throw', async () => {
        const emit = vi.fn();
        const out = await createMemoryNode({ sandbox: makeSandbox({}), emit })({});
        expect(out).toEqual({ context: '' });
        expect(emit).not.toHaveBeenCalled();
    });

    it('a file that exists but fails to read is skipped (non-fatal)', async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({ [DS]: 'design', [CTX]: 'context' });
        // Make the design-system read throw despite exists() being true.
        sandbox.readFile = vi.fn(async (p) => {
            if (p === DS) throw new Error('EIO');
            return 'context body';
        });
        const out = await createMemoryNode({ sandbox, emit })({});
        expect(out.context).toBe(`# ${CTX}\n\ncontext body`);
        expect(emit.mock.calls.map((c) => c[0].file)).toEqual([CTX]);
    });

    it('an empty / whitespace-only file emits no reading event and adds no section', async () => {
        const emit = vi.fn();
        const out = await createMemoryNode({ sandbox: makeSandbox({ [DS]: '   \n\t ' }), emit })({});
        expect(out).toEqual({ context: '' });
        expect(emit).not.toHaveBeenCalled();
    });
});

describe('createMemoryNode — assembly', () => {
    it('joins present files in reserved order, headered + separated, emitting one reading each', async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({ [MEM]: 'M body', [DS]: 'D body' }); // insertion order shuffled
        const out = await createMemoryNode({ sandbox, emit })({});
        // Output order follows RESERVED_CONTEXT_PATHS (DS before MEM), not map order.
        expect(out.context).toBe(`# ${DS}\n\nD body\n\n---\n\n# ${MEM}\n\nM body`);
        expect(emit.mock.calls.map((c) => c[0].file)).toEqual([DS, MEM]);
        expect(emit.mock.calls.every((c) => c[0].type === 'reading')).toBe(true);
    });

    it('trims surrounding whitespace from each section body', async () => {
        const out = await createMemoryNode({ sandbox: makeSandbox({ [DS]: '\n\n  hello  \n\n' }), emit: vi.fn() })({});
        expect(out.context).toBe(`# ${DS}\n\nhello`);
    });

    it('aborted signal short-circuits to empty context without touching the sandbox', async () => {
        const sandbox = makeSandbox({ [DS]: 'x' });
        const controller = new AbortController();
        controller.abort();
        const out = await createMemoryNode({ sandbox, emit: vi.fn() })({ signal: controller.signal });
        expect(out).toEqual({ context: '' });
        expect(sandbox.exists).not.toHaveBeenCalled();
    });
});
