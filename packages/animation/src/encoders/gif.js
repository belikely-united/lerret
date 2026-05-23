// encoders/gif.js — GIF animated encoder.
//
// Backed by `gif.js` — pure-JS GIF89a encoder with Web-Worker support.
// Output is `image/gif`. Universal browser/viewer compatibility; quality
// adequate for short LiveRefresh loops at 256-color palette.

import { AnimationError } from '../index.js';

/**
 * @param {import('../index.js').EncoderOptions} options
 * @returns {Promise<import('../index.js').AnimationEncoder>}
 */
export async function createGifEncoder(options) {
    const { width, height, fps = 24, loop = 'infinite' } = options;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new AnimationError('GIF encoder: width/height must be positive integers', 'INVALID_FRAME');
    }

    // gif.js is a UMD module. It works in browsers and in jsdom where a
    // Worker shim is provided. Test environments without Web Worker support
    // pass `workers: 0` to keep the encoder on the main thread.
    const mod = await import('gif.js');
    const GIF = mod.default || mod;

    // gif.js spawns Web Workers that run the encode loop off the main thread.
    // Without an explicit `workerScript` it defaults to the relative URL
    // `"gif.worker.js"`, which 404s in any host that doesn't sit that file
    // next to the bundle. We resolve the real `gif.worker.js` URL via Vite's
    // `?url` import — handled at build time by the bundler and at runtime by
    // Vite's dev server. The dynamic-import keeps this off the studio's
    // static dependency graph so the rest of the encoder module still loads
    // when `gif.js` is missing (the wrapping try/catch above-from the dialog
    // would have already short-circuited).
    let workerScript;
    try {
        const urlMod = await import('gif.js/dist/gif.worker.js?url');
        workerScript = urlMod.default || urlMod;
    } catch (err) {
        throw new AnimationError(
            `GIF encoder: could not resolve gif.worker.js URL: ${err && err.message ? err.message : String(err)}`,
            'ENCODER_FAILED',
        );
    }

    // Convert loop semantics to gif.js's `repeat` field:
    //   'infinite' → 0   (NETSCAPE2.0 loop forever)
    //   'once'     → -1  (no loop)
    //   N          → N - 1 (loop count + 1 plays in gif.js semantics)
    let repeat;
    if (loop === 'infinite') repeat = 0;
    else if (loop === 'once') repeat = -1;
    else if (Number.isInteger(loop) && loop > 0) repeat = Math.max(0, loop - 1);
    else repeat = 0;

    const gif = new GIF({
        workers: typeof Worker === 'undefined' ? 0 : 2,
        workerScript,
        quality: 10,
        width,
        height,
        repeat,
    });

    let frameCount = 0;

    return {
        addFrame(canvas, durationMs) {
            if (!canvas || typeof canvas.getContext !== 'function') {
                throw new AnimationError('GIF encoder: addFrame requires a Canvas', 'INVALID_FRAME');
            }
            // gif.js expects delay in milliseconds.
            gif.addFrame(canvas, { delay: Math.max(20, Math.round(durationMs)) });
            frameCount += 1;
        },
        finalize() {
            if (frameCount === 0) {
                throw new AnimationError('GIF encoder: no frames added', 'INVALID_FRAME');
            }
            return new Promise((resolve, reject) => {
                gif.on('finished', (blob) => resolve(blob));
                gif.on('abort', () => reject(new AnimationError('GIF encoder: aborted', 'ENCODER_FAILED')));
                try {
                    gif.render();
                } catch (err) {
                    reject(new AnimationError(
                        `GIF encoder: render failed: ${err && err.message ? err.message : String(err)}`,
                        'ENCODER_FAILED',
                    ));
                }
            });
        },
    };
}
