// Tests for the Worker stub. The Worker's job here is dispatch only —
// `executeStep({op:'write', ...})` routes to `sandbox.writeFile`, yields the
// matching event, and returns. Path validation lives in sandbox.test.js;
// this file tests the routing surface ONLY.

import { describe, it, expect, vi } from 'vitest';

import { createWorker } from './worker.js';

/**
 * Local synthetic SandboxViolationError shape. We deliberately do NOT import
 * the real class from `@lerret/core` — `@lerret/ai`'s package.json does not
 * yet depend on `@lerret/core` (the runtime Worker receives the sandbox via
 * dependency injection from the orchestrator, never imports it directly).
 * Story 8.3 may add `@lerret/core` as a peer/optional dep for richer type
 * imports; until then, this synthetic class mirrors the real one's shape
 * (name + code + attemptedPath fields) for the "propagation, not
 * swallowing" assertion below.
 */
class SyntheticSandboxViolationError extends Error {
    constructor({ code, attemptedPath, message }) {
        super(message);
        this.name = 'SandboxViolationError';
        this.code = code;
        this.attemptedPath = attemptedPath;
    }
}

/**
 * Build a `vi.fn()`-backed sandbox that resolves all ops to `undefined`.
 * Tests that need the sandbox to reject overwrite the relevant method via
 * `.mockRejectedValueOnce(...)`.
 */
function makeMockSandbox() {
    return {
        writeFile: vi.fn().mockResolvedValue(undefined),
        deleteFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(''),
        exists: vi.fn().mockResolvedValue(true),
    };
}

/**
 * Drain an async generator into an array. Convenience helper since each
 * `executeStep` call yields exactly one event today (Story 8.3 may yield
 * multiple — keeping the test infrastructure generator-shaped from day one
 * avoids a future rewrite).
 */
async function drain(asyncIterable) {
    const out = [];
    for await (const event of asyncIterable) {
        out.push(event);
    }
    return out;
}

describe('createWorker factory validation', () => {
    it('throws when sandbox is missing', () => {
        // @ts-expect-error — intentionally bad input
        expect(() => createWorker()).toThrow(/sandbox must be a sandbox object/);
        // @ts-expect-error
        expect(() => createWorker({})).toThrow(/sandbox must be a sandbox object/);
    });

    it('throws when sandbox is missing methods', () => {
        // Missing readFile / exists:
        const partial = { writeFile: () => {}, deleteFile: () => {}, mkdir: () => {} };
        // @ts-expect-error — intentionally partial
        expect(() => createWorker({ sandbox: partial })).toThrow(/sandbox must be a sandbox object/);
    });
});

describe('Worker executeStep dispatch', () => {
    it('write step calls sandbox.writeFile and yields { type: writing, file }', async () => {
        const sandbox = makeMockSandbox();
        const worker = createWorker({ sandbox });
        const events = await drain(
            worker.executeStep({ op: 'write', path: '.lerret/social/x.jsx', content: 'hi' }),
        );
        expect(sandbox.writeFile).toHaveBeenCalledTimes(1);
        expect(sandbox.writeFile).toHaveBeenCalledWith('.lerret/social/x.jsx', 'hi');
        expect(events).toEqual([{ type: 'writing', file: '.lerret/social/x.jsx' }]);
    });

    it('delete step calls sandbox.deleteFile', async () => {
        const sandbox = makeMockSandbox();
        const worker = createWorker({ sandbox });
        const events = await drain(
            worker.executeStep({ op: 'delete', path: '.lerret/old.jsx' }),
        );
        expect(sandbox.deleteFile).toHaveBeenCalledTimes(1);
        expect(sandbox.deleteFile).toHaveBeenCalledWith('.lerret/old.jsx');
        expect(events).toEqual([{ type: 'writing', file: '.lerret/old.jsx' }]);
    });

    it('mkdir step calls sandbox.mkdir', async () => {
        const sandbox = makeMockSandbox();
        const worker = createWorker({ sandbox });
        const events = await drain(worker.executeStep({ op: 'mkdir', path: '.lerret/social' }));
        expect(sandbox.mkdir).toHaveBeenCalledTimes(1);
        expect(sandbox.mkdir).toHaveBeenCalledWith('.lerret/social');
        expect(events).toEqual([{ type: 'writing', file: '.lerret/social' }]);
    });

    it('unsupported op yields { type: error, error: unsupported-op, op }', async () => {
        const sandbox = makeMockSandbox();
        const worker = createWorker({ sandbox });
        const events = await drain(worker.executeStep({ op: 'lol', path: 'x' }));
        expect(sandbox.writeFile).not.toHaveBeenCalled();
        expect(sandbox.deleteFile).not.toHaveBeenCalled();
        expect(sandbox.mkdir).not.toHaveBeenCalled();
        expect(events).toEqual([{ type: 'error', error: 'unsupported-op', op: 'lol' }]);
    });

    it('propagates SandboxViolationError thrown by the sandbox (does not swallow)', async () => {
        const sandbox = makeMockSandbox();
        const violation = new SyntheticSandboxViolationError({
            code: 'OUTSIDE_PROJECT',
            attemptedPath: '/etc/passwd',
            message: "path '/etc/passwd' is outside the project sandbox",
        });
        sandbox.writeFile.mockRejectedValueOnce(violation);
        const worker = createWorker({ sandbox });
        // The Worker must NOT catch-and-swallow — the sandbox's rejection
        // must surface to the caller of executeStep verbatim.
        await expect(
            drain(worker.executeStep({ op: 'write', path: '/etc/passwd', content: 'x' })),
        ).rejects.toMatchObject({
            name: 'SandboxViolationError',
            code: 'OUTSIDE_PROJECT',
            attemptedPath: '/etc/passwd',
        });
    });
});
