// frame-capture.js — capture a DOM element as a sequence of Canvases.
//
// Two modes:
//   - 'now'   wall-clock loop: capture frames at `fps` over `durationMs`.
//   - 'cycle' run one full LiveRefresh interval at the asset's own cadence.
//             `durationMs` is ignored; `fps` controls how many frames the
//             output video carries across one `liveRefreshIntervalMs` window.
//
// The capture path is `html-to-image`'s `toCanvas` — the same rendering core
// that powers v1 static (PNG/JPG) export. Pixel fidelity matches across the
// two surfaces.
//
// ── Real-time anchoring (why playback speed is correct) ─────────────────────
// Live content — a clock, a counter — is driven by real wall-clock time and
// can only be observed in real time: a 5-second clock animation takes 5 real
// seconds to capture. The naive loop ("sleep one frame, then capture") is
// WRONG for live content because `toCanvas()` itself takes 30–100 ms. That
// per-frame cost is NOT free: it stretches the real window the capture spans
// (sleep + toCanvas per frame) while the encoder is still told each frame is
// only `frameDurationMs` long. The result is a video whose total length is
// correct but whose content races — a clock that should tick 1·2·3·4·5 over
// 5 s instead rips through ~12 ticks.
//
// The fix: anchor every output frame to an ABSOLUTE schedule. Frame `i` owns
// the slot at real time `startTime + i*frameDurationMs`. Before capturing we
// sleep only the REMAINING slack to that moment — so the toCanvas cost is
// absorbed into the schedule instead of added on top. Two regimes fall out:
//   • capture faster than the per-frame budget → sleep the slack, grab a
//     fresh frame every slot (full fps).
//   • capture slower than the budget → we're past the slot's moment; reuse
//     the most recent frame (duplicate) rather than spend more real time.
//     Effective fps drops, but the timeline stays anchored so playback speed
//     stays true to real time. Total capture wall-time ≈ the requested
//     duration, and the output video length is exactly numFrames*frameDuration.
//
// Streaming pattern: this module does NOT accumulate every frame in memory.
// Each captured frame is handed to the encoder's `addFrame` immediately; only
// the single most-recent Canvas is retained (for duplication). A 5s × 30fps ×
// 3x export would otherwise hold ~150 large Canvases.

import { toCanvas } from 'html-to-image';

import { AnimationError } from './index.js';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Don't bother scheduling sub-millisecond sleeps — the event loop can't honor
// them precisely and they just add overhead.
const SLEEP_EPSILON_MS = 1;

function defaultNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

/**
 * Run a frame-capture loop against `element`, handing each captured frame to
 * `encoder.addFrame(canvas, durationMs)` as it becomes available.
 *
 * @param {Element} element
 * @param {{ addFrame: (canvas: HTMLCanvasElement, durationMs: number) => void, finalize: () => Promise<Blob> }} encoder
 * @param {Object} options
 * @param {'now' | 'cycle'} options.mode
 * @param {number} options.durationMs   Required for 'now' mode.
 * @param {number} options.fps
 * @param {number} [options.scale]      Output pixel ratio (default 1).
 * @param {number} [options.liveRefreshIntervalMs]
 *   Required for 'cycle' mode — the asset's own `liveRefresh.interval`.
 * @param {(i: number, total: number) => void} [options.onProgress]
 *   Called after each frame with `(i, total)`. Useful for the studio dialog's
 *   "Frame N of M" line.
 * @param {AbortSignal} [options.signal]
 *   When aborted, the capture loop stops at the next frame boundary and
 *   throws an `AnimationError` with code `CAPTURE_CANCELLED`.
 * @param {() => number} [options._now]
 *   Test seam — monotonic clock in ms. Defaults to `performance.now()`.
 * @param {(ms: number) => Promise<void>} [options._sleep]
 *   Test seam — sleep. Defaults to a real `setTimeout` promise.
 * @param {(el: Element) => Promise<HTMLCanvasElement>} [options._capture]
 *   Test seam — capture one frame. Defaults to `html-to-image`'s `toCanvas`.
 * @returns {Promise<Blob>}
 *   The encoded animation Blob from `encoder.finalize()`.
 */
export async function captureToEncoder(element, encoder, options) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
        throw new AnimationError('captureToEncoder: element is required', 'INVALID_FRAME');
    }
    if (!encoder || typeof encoder.addFrame !== 'function' || typeof encoder.finalize !== 'function') {
        throw new AnimationError(
            'captureToEncoder: encoder must implement addFrame + finalize',
            'INVALID_FRAME',
        );
    }

    const { mode = 'now', fps = 24, scale = 1, onProgress, signal } = options;
    const now = options._now || defaultNow;
    const doSleep = options._sleep || sleep;
    const capture = options._capture || ((el) => toCanvas(el, { pixelRatio: scale, cacheBust: false }));

    let totalDurationMs;
    if (mode === 'now') {
        if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
            throw new AnimationError(
                'captureToEncoder: durationMs must be a positive number in "now" mode',
                'INVALID_FRAME',
            );
        }
        totalDurationMs = options.durationMs;
    } else if (mode === 'cycle') {
        if (!Number.isFinite(options.liveRefreshIntervalMs) || options.liveRefreshIntervalMs <= 0) {
            throw new AnimationError(
                'captureToEncoder: liveRefreshIntervalMs is required in "cycle" mode',
                'INVALID_FRAME',
            );
        }
        totalDurationMs = options.liveRefreshIntervalMs;
    } else {
        throw new AnimationError(`captureToEncoder: unknown mode "${mode}"`, 'INVALID_FRAME');
    }

    if (!Number.isFinite(fps) || fps <= 0) {
        throw new AnimationError('captureToEncoder: fps must be positive', 'INVALID_FRAME');
    }

    const numFrames = Math.max(1, Math.round((totalDurationMs / 1000) * fps));
    // The video's playback length is exactly numFrames * frameDurationMs ===
    // totalDurationMs (modulo rounding), independent of how long capture takes.
    const frameDurationMs = totalDurationMs / numFrames;

    const startTime = now();
    /** @type {HTMLCanvasElement | null} */
    let lastCanvas = null;

    for (let i = 0; i < numFrames; i++) {
        if (signal?.aborted) {
            throw new AnimationError('captureToEncoder: cancelled', 'CAPTURE_CANCELLED');
        }

        // Absolute slot moment for this output frame and our slack to it.
        const targetTime = startTime + i * frameDurationMs;
        const slackMs = targetTime - now();

        if (slackMs >= 0 || lastCanvas === null) {
            // On or ahead of schedule (or the very first frame): wait out the
            // remaining slack, then capture a FRESH frame at the slot's real
            // moment. Sleeping the slack — not a fixed frame interval — is what
            // absorbs the toCanvas cost and keeps live content at real speed.
            if (slackMs > SLEEP_EPSILON_MS) {
                await doSleep(slackMs);
            }
            try {
                lastCanvas = await capture(element);
            } catch (err) {
                throw new AnimationError(
                    `captureToEncoder: frame ${i + 1}/${numFrames} capture failed: ${err && err.message ? err.message : String(err)}`,
                    'CAPTURE_FAILED',
                );
            }
        }
        // else: behind schedule (capture slower than the per-frame budget) —
        // reuse the most recent frame for this slot. We don't spend extra real
        // time, so the timeline stays anchored and live content keeps real
        // speed; only the effective frame rate drops.

        encoder.addFrame(lastCanvas, frameDurationMs);
        onProgress?.(i + 1, numFrames);
    }

    return encoder.finalize();
}

/**
 * Sample-only variant — captures frames into an in-memory array without
 * involving an encoder. Useful for tests and for the studio dialog's
 * first-frame + last-frame preview.
 *
 * @param {Element} element
 * @param {Object} options  same shape as captureToEncoder minus `encoder`.
 * @returns {Promise<Array<{ canvas: HTMLCanvasElement, durationMs: number }>>}
 */
export async function captureFrames(element, options) {
    const frames = [];
    const fakeEncoder = {
        addFrame(canvas, durationMs) {
            frames.push({ canvas, durationMs });
        },
        async finalize() {
            return new Blob([], { type: 'application/octet-stream' });
        },
    };
    await captureToEncoder(element, fakeEncoder, options);
    return frames;
}
