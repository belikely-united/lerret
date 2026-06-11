// @vitest-environment node
//
// Unit tests for the Inspector node — read-only project Q&A (FR58, Story 8.9).
// Pins:
//   - it answers via the provider handle and emits thinking → inspector-response,
//   - targeted READ-ONLY file inspection: tokens in the question resolve via
//     the sandbox's non-mutating surface, each read emits `reading{file}`, the
//     contents fold into the provider prompt (capped + truncated),
//   - it is structurally write-free: a fully-spied sandbox shows ZERO mutator
//     calls across every path,
//   - the abort guards: pre-aborted short-circuits with no provider call; an
//     abort during the reads skips the round-trip; an abort during the
//     round-trip suppresses the inspector-response event.

import { describe, it, expect, vi } from 'vitest';

import { createInspectorNode, extractFileTokens } from './inspector.js';

function makeHandle(content = 'the answer') {
    return {
        name: 'openai',
        model: 'gpt-4o',
        complete: vi.fn(async () => ({ content })),
    };
}

/**
 * A read-only-honest sandbox stand-in over a relative-path → content map,
 * with SPIED mutators so every test can assert the zero-mutation invariant.
 */
function makeSandbox(files = {}) {
    const map = new Map(Object.entries(files));
    return {
        exists: vi.fn(async (p) => {
            if (!String(p).startsWith('.lerret/')) {
                const err = new Error(`SandboxViolation: outside project — ${p}`);
                err.name = 'SandboxViolationError';
                throw err;
            }
            return map.has(p);
        }),
        readFile: vi.fn(async (p) => {
            if (!map.has(p)) {
                const err = new Error(`ENOENT: ${p}`);
                err.code = 'ENOENT';
                throw err;
            }
            return map.get(p);
        }),
        writeFile: vi.fn(async () => {
            throw new Error('mutator called on the inspect path');
        }),
        deleteFile: vi.fn(async () => {
            throw new Error('mutator called on the inspect path');
        }),
        mkdir: vi.fn(async () => {
            throw new Error('mutator called on the inspect path');
        }),
    };
}

describe('extractFileTokens', () => {
    it('extracts path-looking tokens, deduplicated, order-preserving', () => {
        expect(
            extractFileTokens('compare social/card.jsx with social/card.jsx and _brand/logo.svg'),
        ).toEqual(['social/card.jsx', '_brand/logo.svg']);
    });

    it('strips a leading ./ and accepts .lerret/-prefixed paths verbatim', () => {
        expect(extractFileTokens('open ./card.jsx and .lerret/pages/home.data.json')).toEqual([
            'card.jsx',
            '.lerret/pages/home.data.json',
        ]);
    });

    it('never matches a bare extension and returns [] for non-strings', () => {
        expect(extractFileTokens('what is .jsx anyway?')).toEqual([]);
        expect(extractFileTokens(undefined)).toEqual([]);
        expect(extractFileTokens(42)).toEqual([]);
    });

    it('extracts a token followed by sentence punctuation (trailing dot stays out of the token)', () => {
        expect(extractFileTokens('explain social/card.jsx.')).toEqual(['social/card.jsx']);
        expect(extractFileTokens('is it social/card.jsx, or social/card.css?')).toEqual([
            'social/card.jsx',
            'social/card.css',
        ]);
    });

    it('a 200KB unbroken near-miss run completes in linear time (< 200ms ReDoS bound)', () => {
        // One giant path-charset-only segment packed with `.jsx0` near-miss
        // positions (the `0` defeats the \b). The previous unanchored global
        // regex re-attempted its backtracking match at every index of such a
        // run — quadratic (≈ tens of seconds at 200KB, main-thread). The
        // split + start-anchored matcher does ONE linear attempt per segment.
        const big = `${'a'.repeat(995)}.jsx0`.repeat(200); // ≈ 200KB, zero valid tokens
        const t0 = performance.now();
        const out = extractFileTokens(`explain ${big}`);
        const elapsed = performance.now() - t0;
        expect(out).toEqual([]);
        // Generous bound to dodge CI flake — the real time is single-digit ms.
        expect(elapsed).toBeLessThan(200);
    });
});

describe('createInspectorNode — answer path', () => {
    it('emits thinking + inspector-response and returns the provider answer', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle('42 components');
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'how many?' });

        expect(out).toEqual({ answer: '42 components' });
        const types = emit.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['thinking', 'inspector-response']);
        expect(emit.mock.calls[1][0].answer).toBe('42 components');
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
    });

    it('injects the Memory context into the system prompt', async () => {
        const providerHandle = makeHandle();
        await createInspectorNode({ providerHandle, emit: vi.fn() })({
            prompt: 'q',
            context: 'PROJECT_FACTS',
        });
        const sysMsg = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sysMsg).toMatch(/read-only project inspector/);
        expect(sysMsg).toMatch(/PROJECT_FACTS/);
    });

    it('instructs the model to write project-relative paths verbatim (studio link contract, AC-9)', async () => {
        const providerHandle = makeHandle();
        await createInspectorNode({ providerHandle, emit: vi.fn() })({ prompt: 'q' });
        const sysMsg = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sysMsg).toMatch(/project-relative\s+POSIX path verbatim/);
    });

    it('passes the answer text through VERBATIM — file paths intact for the studio link-detector', async () => {
        const answer = 'The banner is .lerret/social/launch-banner.jsx (last edited last week).';
        const emit = vi.fn();
        const out = await createInspectorNode({ providerHandle: makeHandle(answer), emit })({
            prompt: 'where is the launch banner from last week?',
        });
        expect(out.answer).toBe(answer);
        const respEv = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'inspector-response');
        expect(respEv.answer).toBe(answer);
    });

    it('emits inspector-response with answer:"" when the provider yields no content', async () => {
        const emit = vi.fn();
        const providerHandle = { name: 'openai', model: 'gpt-4o', complete: vi.fn(async () => ({})) };
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'q' });
        expect(out).toEqual({ answer: '' });
        const respEv = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'inspector-response');
        expect(respEv).toEqual({ type: 'inspector-response', answer: '' });
    });
});

describe('createInspectorNode — targeted READ-ONLY file inspection', () => {
    it('resolves a path token via sandbox.exists, emits reading{file}, folds content into the prompt', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const sandbox = makeSandbox({
            '.lerret/social/card.jsx': 'export function Card() { return null; }',
        });
        await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'explain .lerret/social/card.jsx',
        });

        const types = emit.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['thinking', 'reading', 'inspector-response']);
        expect(emit.mock.calls[1][0]).toMatchObject({
            type: 'reading',
            file: '.lerret/social/card.jsx',
        });
        const sysMsg = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sysMsg).toContain('--- .lerret/social/card.jsx ---');
        expect(sysMsg).toContain('export function Card()');
    });

    it('resolves a bare project-relative token through the .lerret/ prefix', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const sandbox = makeSandbox({ '.lerret/social/card.jsx': 'CARD' });
        await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'explain social/card.jsx please',
        });
        expect(emit.mock.calls[1][0]).toMatchObject({
            type: 'reading',
            file: '.lerret/social/card.jsx',
        });
    });

    it('skips tokens that do not resolve to an existing file — no reading event, no files block', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const sandbox = makeSandbox({});
        await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'explain missing.jsx',
        });
        const types = emit.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['thinking', 'inspector-response']);
        const sysMsg = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sysMsg).not.toContain('Referenced project files');
    });

    it('treats sandbox violations (traversal tokens) as not-found — the turn never fails', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle('safe');
        const sandbox = makeSandbox({});
        const out = await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'show me ../../etc/passwd.md',
        });
        expect(out).toEqual({ answer: 'safe' });
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking', 'inspector-response']);
    });

    it('caps targeted reads at 5 files', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const files = {};
        for (let i = 1; i <= 6; i += 1) files[`.lerret/f${i}.jsx`] = `F${i}`;
        const sandbox = makeSandbox(files);
        await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'compare .lerret/f1.jsx .lerret/f2.jsx .lerret/f3.jsx .lerret/f4.jsx .lerret/f5.jsx .lerret/f6.jsx',
        });
        const readEvents = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === 'reading');
        expect(readEvents).toHaveLength(5);
        expect(readEvents.map((e) => e.file)).not.toContain('.lerret/f6.jsx');
    });

    it('truncates oversized file content folded into the prompt', async () => {
        const providerHandle = makeHandle();
        const big = 'x'.repeat(7000);
        const sandbox = makeSandbox({ '.lerret/big.jsx': big });
        await createInspectorNode({ sandbox, providerHandle, emit: vi.fn() })({
            prompt: 'explain .lerret/big.jsx',
        });
        const sysMsg = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sysMsg).toContain('…[truncated]');
        expect(sysMsg).not.toContain(big);
    });

    it('a read error on an existing file degrades to a context-only answer (non-fatal)', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle('degraded fine');
        const sandbox = makeSandbox({ '.lerret/broken.jsx': 'B' });
        sandbox.readFile = vi.fn(async () => {
            throw new Error('EIO');
        });
        const out = await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'explain .lerret/broken.jsx',
        });
        expect(out).toEqual({ answer: 'degraded fine' });
        // No reading event for the failed read; the turn still completes.
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking', 'inspector-response']);
    });

    it('NEVER calls a sandbox mutator — write/delete/mkdir spies stay at zero across a read-heavy turn', async () => {
        const sandbox = makeSandbox({ '.lerret/a.jsx': 'A', '.lerret/b.jsx': 'B' });
        const out = await createInspectorNode({
            sandbox,
            providerHandle: makeHandle(),
            emit: vi.fn(),
        })({ prompt: 'compare .lerret/a.jsx and .lerret/b.jsx' });
        expect(Object.keys(out)).toEqual(['answer']);
        expect(sandbox.writeFile).not.toHaveBeenCalled();
        expect(sandbox.deleteFile).not.toHaveBeenCalled();
        expect(sandbox.mkdir).not.toHaveBeenCalled();
    });

    it('answers from Memory context alone when no sandbox is provided (factory stays backward-compatible)', async () => {
        const emit = vi.fn();
        const out = await createInspectorNode({ providerHandle: makeHandle('ctx only'), emit })({
            prompt: 'explain card.jsx',
            context: 'CTX',
        });
        expect(out).toEqual({ answer: 'ctx only' });
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking', 'inspector-response']);
    });
});

describe('createInspectorNode — abort guards', () => {
    it('pre-aborted signal: no thinking event, no provider call, answer ""', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const controller = new AbortController();
        controller.abort();
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'q', signal: controller.signal });
        expect(out).toEqual({ answer: '' });
        expect(emit).not.toHaveBeenCalled();
        expect(providerHandle.complete).not.toHaveBeenCalled();
    });

    it('abort after Memory (between the entry + pre-complete guards) skips the LLM round-trip', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        // aborted is false on the entry guard, true on every later read.
        let reads = 0;
        const signal = {
            get aborted() {
                reads += 1;
                return reads > 1;
            },
        };
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'q', signal });
        expect(out).toEqual({ answer: '' });
        // thinking() was emitted (entry guard passed) but complete() was skipped.
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking']);
        expect(providerHandle.complete).not.toHaveBeenCalled();
    });

    it('abort during the targeted reads halts before the provider call', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const sandbox = makeSandbox({ '.lerret/a.jsx': 'A', '.lerret/b.jsx': 'B' });
        const flag = { aborted: false };
        // The abort lands while the FIRST file is being read.
        const realRead = sandbox.readFile;
        sandbox.readFile = vi.fn(async (p) => {
            flag.aborted = true;
            return realRead(p);
        });
        const out = await createInspectorNode({ sandbox, providerHandle, emit })({
            prompt: 'compare .lerret/a.jsx and .lerret/b.jsx',
            signal: flag,
        });
        expect(out).toEqual({ answer: '' });
        expect(providerHandle.complete).not.toHaveBeenCalled();
        // The in-flight read completed (thinking + reading) but the second
        // token's loop guard halted the turn.
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking', 'reading']);
    });

    it('abort during the provider round-trip suppresses the inspector-response event', async () => {
        const emit = vi.fn();
        const flag = { aborted: false };
        const providerHandle = {
            name: 'openai',
            model: 'gpt-4o',
            complete: vi.fn(async () => {
                flag.aborted = true; // Stop pressed mid-round-trip.
                return { content: 'late answer' };
            }),
        };
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'q', signal: flag });
        expect(out).toEqual({ answer: '' });
        const types = emit.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['thinking']);
        expect(types).not.toContain('inspector-response');
    });
});
