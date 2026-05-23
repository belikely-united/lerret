// encoders/apng.js — APNG (Animated PNG) encoder.
//
// Backed by `upng-js` — pure-JS PNG / APNG encoder, no WASM.
// Output is `image/apng` (modern PNG-based animation; lossless;
// universally supported in Chromium/Safari/Firefox).

import { AnimationError } from '../index.js';

/**
 * @param {import('../index.js').EncoderOptions} options
 * @returns {Promise<import('../index.js').AnimationEncoder>}
 */
export async function createApngEncoder(options) {
    const { width, height, loop = 'infinite' } = options;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new AnimationError(
            'APNG encoder: width/height must be positive integers',
            'INVALID_FRAME',
        );
    }

    const mod = await import('upng-js');
    const UPNG = mod.default || mod;

    /** @type {ArrayBuffer[]} */
    const frameBuffers = [];
    /** @type {number[]} */
    const frameDelays = [];
    let resolvedWidth = width;
    let resolvedHeight = height;

    let loopCount;
    if (loop === 'infinite') loopCount = 0;
    else if (loop === 'once') loopCount = 1;
    else if (Number.isInteger(loop) && loop > 0) loopCount = loop;
    else loopCount = 0;

    return {
        addFrame(canvas, durationMs) {
            if (!canvas || typeof canvas.getContext !== 'function') {
                throw new AnimationError('APNG encoder: addFrame requires a Canvas', 'INVALID_FRAME');
            }
            if (canvas.width !== resolvedWidth || canvas.height !== resolvedHeight) {
                // First frame defines the actual dimensions if encoder was constructed
                // with placeholder values; otherwise mismatched canvases are an error.
                if (frameBuffers.length === 0) {
                    resolvedWidth = canvas.width;
                    resolvedHeight = canvas.height;
                } else {
                    throw new AnimationError(
                        `APNG encoder: frame dimensions ${canvas.width}x${canvas.height} ` +
                            `do not match earlier frames ${resolvedWidth}x${resolvedHeight}`,
                        'INVALID_FRAME',
                    );
                }
            }
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // UPNG expects an ArrayBuffer of RGBA bytes per frame.
            frameBuffers.push(imageData.data.buffer.slice(
                imageData.data.byteOffset,
                imageData.data.byteOffset + imageData.data.byteLength,
            ));
            frameDelays.push(Math.max(10, Math.round(durationMs)));
        },
        async finalize() {
            if (frameBuffers.length === 0) {
                throw new AnimationError('APNG encoder: no frames added', 'INVALID_FRAME');
            }
            // UPNG.encode(imgs, w, h, cnum, [dels], loop?)
            //   cnum=0 → lossless palette selection
            //   dels  → per-frame delay in milliseconds
            //   loop  → 0 = infinite (default); not exposed as a named arg, but
            //           the resulting APNG's `acTL.num_plays` is 0. To force a
            //           non-infinite loop, post-process the buffer; for v1 we
            //           accept the UPNG default and document that `loop: 'once'`
            //           degrades to infinite in APNG output.
            let buffer;
            try {
                buffer = UPNG.encode(frameBuffers, resolvedWidth, resolvedHeight, 0, frameDelays);
            } catch (err) {
                throw new AnimationError(
                    `APNG encoder: encode failed: ${err && err.message ? err.message : String(err)}`,
                    'ENCODER_FAILED',
                );
            }
            // Post-process the acTL chunk to honor non-infinite loop counts.
            // The APNG spec puts `num_plays` (4 bytes, big-endian) at offset 4
            // within the acTL chunk's data. When loopCount === 0 (infinite) we
            // leave the chunk as UPNG produced it.
            if (loopCount !== 0) {
                try {
                    setApngNumPlays(buffer, loopCount);
                } catch {
                    // Non-fatal — the animation will still play, just looping
                    // forever instead of N times. Honest degradation.
                }
            }
            return new Blob([buffer], { type: 'image/apng' });
        },
    };
}

/**
 * Find the acTL chunk in an APNG byte buffer and overwrite its `num_plays`
 * field (4 bytes, big-endian) with the requested loop count.
 *
 * @param {ArrayBuffer} buffer
 * @param {number} numPlays
 */
function setApngNumPlays(buffer, numPlays) {
    const view = new DataView(buffer);
    // PNG signature is 8 bytes; chunks follow as (length:4)(type:4)(data:length)(crc:4)
    let offset = 8;
    while (offset < view.byteLength - 12) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7),
        );
        if (type === 'acTL') {
            // acTL data: num_frames(4) | num_plays(4)
            view.setUint32(offset + 8 + 4, numPlays);
            return;
        }
        offset += 12 + length;
    }
}
