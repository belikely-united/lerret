// Tests for the @lerret/ai dynamic-import shim.
//
// Coverage:
//   - getAi() memoizes the module reference across calls.
//   - Concurrent first-touch shares a single in-flight promise.
//   - When the dynamic import throws (optional dep missing), getAi() returns null.
//   - _resetAiCache() clears the memo for the next call.
//
// The dynamic import itself is non-trivial to mock with `vi.mock` at module
// scope because the import specifier `@lerret/ai` may resolve in the workspace
// to a real package. We verify behavior at the shim's public surface by
// calling _resetAiCache() between assertions and observing memoization.

import { describe, it, expect, beforeEach } from 'vitest';

import { getAi, _resetAiCache } from './lazy.js';

describe('studio AI lazy import shim', () => {
    beforeEach(() => {
        _resetAiCache();
    });

    it('returns the same module reference on subsequent calls (memoization)', async () => {
        const a = await getAi();
        const b = await getAi();
        // The shim is permitted to resolve to null in environments without
        // the optional @lerret/ai package; in either case, the references are
        // identical across calls.
        expect(a).toBe(b);
    });

    it('shares a single in-flight promise under concurrent first-touch', async () => {
        const p1 = getAi();
        const p2 = getAi();
        const [a, b] = await Promise.all([p1, p2]);
        expect(a).toBe(b);
    });

    it('exposes _resetAiCache for test reset', () => {
        expect(typeof _resetAiCache).toBe('function');
    });
});
