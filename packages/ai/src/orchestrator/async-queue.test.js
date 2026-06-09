// @vitest-environment node
//
// Unit tests for the closable async queue — the bridge between synchronous
// node `emit(event)` calls and the `runTurn` async-generator drain loop.
//
// `fail()` is currently UNUSED by run-turn.js (which surfaces graph errors as a
// terminal `error` TurnEvent rather than a rejected stream — see the header
// comment in async-queue.js). These tests pin its contract so the retained-but-
// unused path cannot silently rot, and assert the push/buffer/close ordering
// the orchestrator depends on.

import { describe, it, expect } from 'vitest';

import { createAsyncQueue } from './async-queue.js';

/** Drain an async iterable into an array. */
async function collect(iter) {
    const out = [];
    for await (const item of iter) out.push(item);
    return out;
}

describe('createAsyncQueue — buffering + close', () => {
    it('delivers items pushed before iteration starts (buffered), in order', async () => {
        const q = createAsyncQueue();
        q.push('a');
        q.push('b');
        q.push('c');
        q.close();
        expect(await collect(q)).toEqual(['a', 'b', 'c']);
    });

    it('delivers an item pushed WHILE a consumer is awaiting next() (waiter path)', async () => {
        const q = createAsyncQueue();
        const it = q[Symbol.asyncIterator]();
        const pending = it.next(); // no buffered item — registers a waiter
        q.push('live');
        await expect(pending).resolves.toEqual({ value: 'live', done: false });
    });

    it('close() resolves a pending waiter with done:true', async () => {
        const q = createAsyncQueue();
        const it = q[Symbol.asyncIterator]();
        const pending = it.next();
        q.close();
        await expect(pending).resolves.toEqual({ value: undefined, done: true });
    });

    it('push() after close() is a no-op (does not resurrect the stream)', async () => {
        const q = createAsyncQueue();
        q.push('a');
        q.close();
        q.push('b'); // dropped
        expect(await collect(q)).toEqual(['a']);
    });

    it('drains buffered items BEFORE reporting done, even when closed mid-buffer', async () => {
        const q = createAsyncQueue();
        q.push('a');
        q.push('b');
        q.close();
        const it = q[Symbol.asyncIterator]();
        expect(await it.next()).toEqual({ value: 'a', done: false });
        expect(await it.next()).toEqual({ value: 'b', done: false });
        expect(await it.next()).toEqual({ value: undefined, done: true });
    });
});

describe('createAsyncQueue — fail() (retained, currently unused by run-turn)', () => {
    it('rejects a pending waiter with the supplied error', async () => {
        const q = createAsyncQueue();
        const it = q[Symbol.asyncIterator]();
        const pending = it.next();
        const boom = new Error('boom');
        q.fail(boom);
        await expect(pending).rejects.toBe(boom);
    });

    it('rejects the NEXT next() when fail() was called before iteration', async () => {
        const q = createAsyncQueue();
        const boom = new Error('later');
        q.fail(boom);
        const it = q[Symbol.asyncIterator]();
        await expect(it.next()).rejects.toBe(boom);
    });

    it('surfaces buffered items first, then rejects (failure observed after drain)', async () => {
        const q = createAsyncQueue();
        q.push('a');
        const boom = new Error('after-a');
        q.fail(boom);
        const it = q[Symbol.asyncIterator]();
        expect(await it.next()).toEqual({ value: 'a', done: false });
        await expect(it.next()).rejects.toBe(boom);
    });

    it('fail() after close() is a no-op (already-terminated stream stays clean)', async () => {
        const q = createAsyncQueue();
        q.push('a');
        q.close();
        q.fail(new Error('ignored'));
        // Stream ends cleanly with the buffered item; no rejection.
        expect(await collect(q)).toEqual(['a']);
    });
});
