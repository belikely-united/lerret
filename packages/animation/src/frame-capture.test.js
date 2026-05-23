// frame-capture.test.js — timing/real-time-anchoring contract for the capture
// loop. These tests pin the fix for the "live clock plays back too fast" bug:
// the captured content must span the requested REAL duration (not duration +
// N*toCanvas), and the output video length must equal numFrames*frameDuration
// regardless of how slow capture is.
//
// The loop is exercised through its test seams (`_now`, `_sleep`, `_capture`)
// so timing is fully deterministic — no real timers, no real DOM rasterizer.

import { describe, it, expect } from 'vitest';

import { captureToEncoder } from './frame-capture.js';

// A fake element — the loop only checks `getBoundingClientRect` exists.
const fakeElement = { getBoundingClientRect: () => ({ width: 100, height: 100 }) };

/**
 * Deterministic capture harness. A virtual clock advances ONLY when the loop
 * sleeps or captures: `_sleep(ms)` adds `ms`, and each `_capture()` consumes
 * `captureMs` of virtual time (simulating html-to-image's cost). We record the
 * virtual timestamp of every FRESH capture so tests can assert the real window
 * the content was sampled across.
 *
 * @param {{ captureMs: number }} opts
 */
function makeHarness({ captureMs }) {
    let clock = 0;
    const freshAt = []; // virtual timestamps of fresh captures
    let id = 0;
    return {
        deps: {
            _now: () => clock,
            _sleep: async (ms) => { clock += ms; },
            _capture: async () => {
                freshAt.push(clock);
                clock += captureMs;
                id += 1;
                return { __fakeCanvas: id };
            },
        },
        get freshAt() { return freshAt; },
        get clock() { return clock; },
    };
}

/** Collect frames an encoder receives. */
function collectingEncoder() {
    const frames = [];
    return {
        frames,
        addFrame(canvas, durationMs) { frames.push({ canvas, durationMs }); },
        async finalize() { return new Blob([], { type: 'application/octet-stream' }); },
    };
}

describe('captureToEncoder — real-time anchoring', () => {
    it('output frame count and total playback length match duration×fps (slow capture)', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 100 }); // toCanvas slower than 41.67ms budget
        await captureToEncoder(fakeElement, enc, {
            mode: 'now', durationMs: 5000, fps: 24, ...h.deps,
        });
        // round(5 * 24) = 120 output frames.
        expect(enc.frames.length).toBe(120);
        // Each frame is allotted totalDuration/numFrames; the sum is the video
        // length and MUST equal the requested duration regardless of capture cost.
        const totalPlayback = enc.frames.reduce((s, f) => s + f.durationMs, 0);
        expect(totalPlayback).toBeCloseTo(5000, 5);
    });

    it('content is sampled across the REAL requested window, not duration + N×toCanvas (the bug)', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 100 });
        await captureToEncoder(fakeElement, enc, {
            mode: 'now', durationMs: 5000, fps: 24, ...h.deps,
        });
        // The LAST fresh capture must land near the end of the 5s window — NOT
        // out near 120*(41.67+100) ≈ 17s, which is what the old loop produced
        // (and what made the clock race ~3.4×). Allow one capture of slack.
        const lastFresh = h.freshAt[h.freshAt.length - 1];
        expect(lastFresh).toBeLessThan(5200);
        // Total virtual wall-time spent ≈ the requested duration (+ one capture).
        expect(h.clock).toBeLessThan(5200);
        expect(h.clock).toBeGreaterThan(4800);
    });

    it('duplicates frames when capture is slower than the frame budget (fps degrades, timing holds)', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 100 }); // ~1 fresh frame per 100ms → ~50 over 5s
        await captureToEncoder(fakeElement, enc, {
            mode: 'now', durationMs: 5000, fps: 24, ...h.deps,
        });
        // 120 output slots, but far fewer distinct captures (duplication).
        expect(h.freshAt.length).toBeLessThan(120);
        expect(h.freshAt.length).toBeGreaterThan(30); // ~40–50 expected
        // Distinct canvases referenced ≤ fresh captures.
        const distinct = new Set(enc.frames.map((f) => f.canvas.__fakeCanvas));
        expect(distinct.size).toBe(h.freshAt.length);
    });

    it('captures a fresh frame every slot when capture is faster than the budget', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 10 }); // well under the 41.67ms budget
        await captureToEncoder(fakeElement, enc, {
            mode: 'now', durationMs: 5000, fps: 24, ...h.deps,
        });
        // Fresh capture for every output frame — no duplication needed.
        expect(h.freshAt.length).toBe(120);
        const distinct = new Set(enc.frames.map((f) => f.canvas.__fakeCanvas));
        expect(distinct.size).toBe(120);
        // Fresh captures are paced ~one frame-budget apart and the window ≈ 5s.
        expect(h.freshAt[h.freshAt.length - 1]).toBeGreaterThan(4800);
        expect(h.freshAt[h.freshAt.length - 1]).toBeLessThan(5200);
    });

    it('60fps still anchors to real time (duplicates heavily, video length correct)', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 50 }); // way over the 16.67ms budget @60fps
        await captureToEncoder(fakeElement, enc, {
            mode: 'now', durationMs: 3000, fps: 60, ...h.deps,
        });
        expect(enc.frames.length).toBe(180); // round(3 * 60)
        const totalPlayback = enc.frames.reduce((s, f) => s + f.durationMs, 0);
        expect(totalPlayback).toBeCloseTo(3000, 5);
        // Content window ≈ 3s real, not 180×50ms = 9s.
        expect(h.freshAt[h.freshAt.length - 1]).toBeLessThan(3200);
        expect(h.clock).toBeLessThan(3200);
    });

    it('cycle mode anchors to liveRefreshIntervalMs, not durationMs', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 10 });
        await captureToEncoder(fakeElement, enc, {
            mode: 'cycle', liveRefreshIntervalMs: 1000, durationMs: 5000, fps: 24, ...h.deps,
        });
        // One 1000ms cycle at 24fps → round(1 * 24) = 24 frames.
        expect(enc.frames.length).toBe(24);
        const totalPlayback = enc.frames.reduce((s, f) => s + f.durationMs, 0);
        expect(totalPlayback).toBeCloseTo(1000, 5);
        // Content sampled across the ~1s cycle, not the ignored 5s duration.
        expect(h.freshAt[h.freshAt.length - 1]).toBeLessThan(1100);
    });

    it('aborts mid-capture via signal', async () => {
        const enc = collectingEncoder();
        const h = makeHarness({ captureMs: 10 });
        const controller = new AbortController();
        // Abort after the 3rd frame is added.
        const wrapped = {
            frames: enc.frames,
            addFrame: (c, d) => { enc.addFrame(c, d); if (enc.frames.length === 3) controller.abort(); },
            finalize: enc.finalize,
        };
        await expect(
            captureToEncoder(fakeElement, wrapped, {
                mode: 'now', durationMs: 5000, fps: 24, signal: controller.signal, ...h.deps,
            }),
        ).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });
        expect(enc.frames.length).toBe(3);
    });
});
