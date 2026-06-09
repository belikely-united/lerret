// @vitest-environment node
//
// Unit tests for the DS Curator node — brand-token authority. Pins:
//   - `_design-system.md` is PRIMARY; `config.json` `vars` is SECONDARY,
//   - a token both sources define DIFFERENTLY emits a conflict tool-call note
//     and resolves to the primary value (never auto-reconciles),
//   - secondary fills gaps the primary leaves,
//   - Story 8.3 review proto-safety: a token named `constructor` is stored as a
//     real own key (Object.create(null) map) and does not break resolution.

import { describe, it, expect, vi } from 'vitest';

import { createDsCuratorNode } from './ds-curator.js';

const DS_PATH = '.lerret/_design-system.md';
const CFG_PATH = '.lerret/config.json';

/**
 * A sandbox stub backed by a plain map of relPath → string contents. A missing
 * path makes `exists` false and `readFile` throw (graceful-absence exercise).
 */
function makeSandbox(files = {}) {
    return {
        exists: vi.fn(async (p) => Object.prototype.hasOwnProperty.call(files, p)),
        readFile: vi.fn(async (p) => {
            if (!Object.prototype.hasOwnProperty.call(files, p)) {
                const err = new Error(`ENOENT ${p}`);
                err.code = 'ENOENT';
                throw err;
            }
            return files[p];
        }),
    };
}

describe('createDsCuratorNode — authority order', () => {
    it('design-system PRIMARY wins on conflict and emits a conflict note', async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({
            [DS_PATH]: '- brand-orange: #ff6600',
            [CFG_PATH]: JSON.stringify({ vars: { 'brand-orange': '#ff0000' } }),
        });
        const out = await createDsCuratorNode({ sandbox, emit })({});
        expect(out.brandTokens['brand-orange']).toBe('#ff6600'); // primary, not config
        const note = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'tool-call');
        expect(note).toBeDefined();
        expect(note.name).toMatch(/brand-token conflict on 'brand-orange'/);
        expect(note.name).toMatch(/using _design-system\.md \(primary\)/);
    });

    it('secondary (config vars) fills tokens the primary does not define; no spurious note', async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({
            [DS_PATH]: '- brand-orange: #ff6600',
            [CFG_PATH]: JSON.stringify({ vars: { radius: '8px' } }),
        });
        const out = await createDsCuratorNode({ sandbox, emit })({});
        expect(out.brandTokens).toMatchObject({ 'brand-orange': '#ff6600', radius: '8px' });
        // Disjoint keys → no conflict note.
        expect(emit.mock.calls.some((c) => c[0]?.type === 'tool-call')).toBe(false);
    });

    it('agreeing values do not emit a conflict note', async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({
            [DS_PATH]: '- brand-orange: #ff6600',
            [CFG_PATH]: JSON.stringify({ vars: { 'brand-orange': '#ff6600' } }),
        });
        await createDsCuratorNode({ sandbox, emit })({});
        expect(emit.mock.calls.some((c) => c[0]?.type === 'tool-call')).toBe(false);
    });
});

describe('createDsCuratorNode — graceful absence + robustness', () => {
    it('no files → empty brandTokens, no events, no throw', async () => {
        const emit = vi.fn();
        const out = await createDsCuratorNode({ sandbox: makeSandbox({}), emit })({});
        expect(out.brandTokens).toEqual({});
        expect(emit).not.toHaveBeenCalled();
    });

    it('malformed config.json is swallowed; primary still resolves', async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({
            [DS_PATH]: '- brand-orange: #ff6600',
            [CFG_PATH]: '{ this is : not json',
        });
        const out = await createDsCuratorNode({ sandbox, emit })({});
        expect(out.brandTokens).toEqual({ 'brand-orange': '#ff6600' });
    });

    it('aborted signal short-circuits to empty brandTokens without reading', async () => {
        const sandbox = makeSandbox({ [DS_PATH]: '- x: #fff' });
        const controller = new AbortController();
        controller.abort();
        const out = await createDsCuratorNode({ sandbox, emit: vi.fn() })({ signal: controller.signal });
        expect(out.brandTokens).toEqual({});
        expect(sandbox.exists).not.toHaveBeenCalled();
    });
});

describe('createDsCuratorNode — prototype-pollution safety', () => {
    it("a token named 'constructor' is captured as data, conflicts correctly, and never pollutes", async () => {
        const emit = vi.fn();
        const sandbox = makeSandbox({
            [DS_PATH]: '- constructor: #fff',
            [CFG_PATH]: JSON.stringify({ vars: { constructor: '#000' } }),
        });
        const out = await createDsCuratorNode({ sandbox, emit })({});
        // Resolved as a plain data value, primary wins.
        expect(out.brandTokens.constructor).toBe('#fff');
        // Conflict surfaced like any other token.
        const note = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'tool-call');
        expect(note.name).toMatch(/brand-token conflict on 'constructor'/);
        // Object.prototype is untouched.
        expect(Object.prototype.constructor).toBe(Object);
    });
});
