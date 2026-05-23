// encoders/webp.js — Animated WebP encoder.
//
// Strategy: use the BROWSER-NATIVE WebP encoder via `canvas.toBlob('image/webp', q)`
// for each frame, then strip each frame's RIFF/WEBP wrapper and assemble a
// single animated-WebP container by hand (RIFF + VP8X + ANIM + N×ANMF).
//
// No WASM payload. Hardware-accelerated WebP encoding where the platform
// supports it. Animated-WebP container spec:
//   https://developers.google.com/speed/webp/docs/riff_container
//
// Output is `image/webp` (animated). Plays in every modern browser; some
// preview apps may treat it as a still frame — `.gif` and `.apng` exist as
// universal fallbacks (Story 7.5).

import { AnimationError } from '../index.js';

const WEBP_QUALITY = 0.85;

/**
 * @param {import('../index.js').EncoderOptions} options
 * @returns {Promise<import('../index.js').AnimationEncoder>}
 */
export async function createWebpEncoder(options) {
    const { width, height, loop = 'infinite' } = options;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new AnimationError(
            'WebP encoder: width/height must be positive integers',
            'INVALID_FRAME',
        );
    }

    /** @type {Array<{ vp8Chunks: Uint8Array, durationMs: number, hasAlpha: boolean }>} */
    const frames = [];
    let canvasW = width;
    let canvasH = height;

    let loopCount;
    if (loop === 'infinite') loopCount = 0;
    else if (loop === 'once') loopCount = 1;
    else if (Number.isInteger(loop) && loop >= 0) loopCount = loop;
    else loopCount = 0;

    return {
        addFrame(canvas, durationMs) {
            if (!canvas || typeof canvas.toBlob !== 'function') {
                throw new AnimationError('WebP encoder: addFrame requires a Canvas', 'INVALID_FRAME');
            }
            if (frames.length === 0) {
                canvasW = canvas.width;
                canvasH = canvas.height;
            }
            // We cache the blob promise here; resolution happens in finalize() so
            // addFrame stays sync (matches the AnimationEncoder shape).
            frames.push({
                // @ts-expect-error — pending value, resolved in finalize().
                vp8Chunks: canvasToWebpBlobPromise(canvas),
                durationMs: clampDuration(durationMs),
                hasAlpha: false, // updated when we actually parse the blob
            });
        },
        async finalize() {
            if (frames.length === 0) {
                throw new AnimationError('WebP encoder: no frames added', 'INVALID_FRAME');
            }
            // Resolve all pending Canvas→WebP blobs in parallel, then parse each
            // for its VP8/VP8L chunk.
            const resolvedFrames = await Promise.all(
                frames.map(async (frame) => {
                    const blob = await frame.vp8Chunks;
                    const buffer = new Uint8Array(await blob.arrayBuffer());
                    const { vp8Chunks, hasAlpha } = extractFrameChunks(buffer);
                    return {
                        vp8Chunks,
                        durationMs: frame.durationMs,
                        hasAlpha,
                    };
                }),
            );

            const container = assembleAnimatedWebp({
                width: canvasW,
                height: canvasH,
                loopCount,
                frames: resolvedFrames,
            });
            return new Blob([container], { type: 'image/webp' });
        },
    };
}

/**
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @returns {Promise<Blob>}
 */
function canvasToWebpBlobPromise(canvas) {
    if (typeof canvas.convertToBlob === 'function') {
        return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    }
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new AnimationError('WebP encoder: canvas.toBlob returned null', 'ENCODER_FAILED'));
            },
            'image/webp',
            WEBP_QUALITY,
        );
    });
}

/**
 * Clamp duration to the WebP ANMF range. The ANMF `frame_duration` field is
 * 3 bytes (24-bit unsigned), so the max is 16777215 ms (~4.6 hours). 0 is
 * legal but typically interpreted as "skip" by viewers, so we clamp to 1 ms.
 *
 * @param {number} ms
 * @returns {number}
 */
function clampDuration(ms) {
    if (!Number.isFinite(ms) || ms < 1) return 1;
    return Math.min(0xffffff, Math.round(ms));
}

/**
 * Parse a still-WebP blob's container and extract just the VP8 / VP8L / ALPH
 * chunks suitable for embedding in an ANMF frame.
 *
 * Layout of a still WebP from `canvas.toBlob('image/webp')`:
 *   "RIFF" (4) | filesize-8 (4 LE) | "WEBP" (4) | <chunks>
 *
 * Chunks we care about:
 *   VP8 (lossy), VP8L (lossless), VP8X (extended header — skip), ALPH (alpha
 *   for lossy), ICCP/EXIF/XMP (metadata — skip).
 *
 * @param {Uint8Array} buf
 * @returns {{ vp8Chunks: Uint8Array, hasAlpha: boolean }}
 */
function extractFrameChunks(buf) {
    if (
        buf.length < 12 ||
        readFourCC(buf, 0) !== 'RIFF' ||
        readFourCC(buf, 8) !== 'WEBP'
    ) {
        throw new AnimationError('WebP encoder: malformed WebP frame', 'ENCODER_FAILED');
    }

    /** @type {Array<Uint8Array>} */
    const wantedChunks = [];
    let hasAlpha = false;

    let offset = 12;
    while (offset + 8 <= buf.length) {
        const fourCC = readFourCC(buf, offset);
        const chunkSize = readU32LE(buf, offset + 4);
        const headerEnd = offset + 8;
        const paddedSize = chunkSize + (chunkSize % 2);
        const chunkEnd = headerEnd + paddedSize;

        if (fourCC === 'VP8 ' || fourCC === 'VP8L' || fourCC === 'ALPH') {
            wantedChunks.push(buf.subarray(offset, chunkEnd));
            if (fourCC === 'ALPH' || fourCC === 'VP8L') hasAlpha = true;
        }
        // Skip VP8X, ICCP, EXIF, XMP, ANIM, ANMF (shouldn't appear in still output) etc.

        offset = chunkEnd;
    }

    if (wantedChunks.length === 0) {
        throw new AnimationError(
            'WebP encoder: no VP8/VP8L chunks found in frame',
            'ENCODER_FAILED',
        );
    }

    const total = wantedChunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of wantedChunks) {
        out.set(chunk, pos);
        pos += chunk.length;
    }
    return { vp8Chunks: out, hasAlpha };
}

/**
 * Assemble an animated WebP container from extracted frame chunks.
 *
 * @param {Object} args
 * @param {number} args.width
 * @param {number} args.height
 * @param {number} args.loopCount  0 = infinite
 * @param {Array<{ vp8Chunks: Uint8Array, durationMs: number, hasAlpha: boolean }>} args.frames
 * @returns {Uint8Array}
 */
function assembleAnimatedWebp({ width, height, loopCount, frames }) {
    // RIFF header (12 bytes, size patched at end)
    // VP8X chunk (18 bytes): tag(4) + size(4)=10 + flags(4) + cw(3) + ch(3)
    //   flag bits we set: animation (0x02), alpha (0x10) iff any frame has alpha
    // ANIM chunk (14 bytes): tag(4) + size(4)=6 + bg(4)=0 + loop(2)
    // ANMF chunks: tag(4) + size(4) + x(3) + y(3) + w-1(3) + h-1(3) + dur(3) + flags(1) + data + pad

    const anyAlpha = frames.some((f) => f.hasAlpha);

    // Compute per-frame ANMF sizes first to size the RIFF total.
    const frameBlocks = frames.map((frame) => buildAnmfChunk(frame, width, height));

    // RIFF body: starts with "WEBP" (4) + VP8X(18) + ANIM(14) + sum(frames)
    const bodySize =
        4 /* "WEBP" */ +
        18 /* VP8X */ +
        14 /* ANIM */ +
        frameBlocks.reduce((sum, b) => sum + b.length, 0);

    const out = new Uint8Array(8 + bodySize);
    writeFourCC(out, 0, 'RIFF');
    writeU32LE(out, 4, bodySize);
    writeFourCC(out, 8, 'WEBP');

    let pos = 12;

    // VP8X
    writeFourCC(out, pos, 'VP8X');
    writeU32LE(out, pos + 4, 10);
    // flags: bit 1 = animation; bit 4 = alpha (per WebP spec)
    const flags = 0x02 | (anyAlpha ? 0x10 : 0);
    out[pos + 8] = flags;
    out[pos + 9] = 0;
    out[pos + 10] = 0;
    out[pos + 11] = 0;
    writeU24LE(out, pos + 12, width - 1);
    writeU24LE(out, pos + 15, height - 1);
    pos += 18;

    // ANIM
    writeFourCC(out, pos, 'ANIM');
    writeU32LE(out, pos + 4, 6);
    writeU32LE(out, pos + 8, 0); // background color (BGRA, 0 = transparent)
    out[pos + 12] = loopCount & 0xff;
    out[pos + 13] = (loopCount >> 8) & 0xff;
    pos += 14;

    // ANMF chunks
    for (const block of frameBlocks) {
        out.set(block, pos);
        pos += block.length;
    }

    return out;
}

/**
 * Build one ANMF chunk for a frame.
 *
 * @param {{ vp8Chunks: Uint8Array, durationMs: number, hasAlpha: boolean }} frame
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {Uint8Array}
 */
function buildAnmfChunk(frame, canvasW, canvasH) {
    // ANMF header (24 bytes): 4 tag + 4 size + 3 x + 3 y + 3 w-1 + 3 h-1 + 3 dur + 1 flags.
    // The previous value of 16 was a sum-arithmetic typo (the fields total 24);
    // it made `out` 8 bytes too small and `out.set(frame.vp8Chunks, 24)` threw
    // "offset is out of bounds" on every animated WebP frame.
    const headerSize = 24;
    const dataSize = frame.vp8Chunks.length;
    // Padded to even byte boundary per RIFF spec.
    const padded = dataSize + (dataSize % 2);
    const chunkBody = headerSize - 8 + dataSize; // size field counts everything after the size field itself

    const out = new Uint8Array(8 + chunkBody + (padded - dataSize));
    writeFourCC(out, 0, 'ANMF');
    writeU32LE(out, 4, chunkBody);
    writeU24LE(out, 8, 0); // frame_x (must be even; 0 is fine)
    writeU24LE(out, 11, 0); // frame_y
    writeU24LE(out, 14, canvasW - 1); // frame_width - 1
    writeU24LE(out, 17, canvasH - 1); // frame_height - 1
    writeU24LE(out, 20, frame.durationMs);
    // ANMF flags byte (per WebP container spec): bits 0–5 reserved, bit 6 (0x02)
    // = blending method, bit 7 (0x01) = disposal method.
    //   Blending: 0 = alpha-blend this frame onto the prior canvas; 1 = OVERWRITE
    //   Disposal: 0 = keep canvas; 1 = dispose to background
    // We emit FULL-FRAME keyframes (every frame is the whole 1080×540 image), so
    // alpha-blending each frame onto the previous one is both unnecessary and a
    // bug source: anti-aliased glyph edges carry alpha < 255, so blend mode lets
    // the PREVIOUS frame's pixels ghost through (overlapping digits). Overwrite
    // (0x02) makes each frame cleanly replace the canvas — the correct disposal
    // for keyframe animation and what libwebp's own `img2webp` uses for full
    // frames. Also maximizes compatibility across the patchier WebP viewers.
    out[23] = 0x02;
    out.set(frame.vp8Chunks, 24);
    // Padding byte (already zeroed by Uint8Array initialization).
    return out;
}

// ── Little-endian helpers ───────────────────────────────────────────────────

function readFourCC(buf, offset) {
    return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

function readU32LE(buf, offset) {
    return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

function writeFourCC(buf, offset, fourCC) {
    buf[offset] = fourCC.charCodeAt(0);
    buf[offset + 1] = fourCC.charCodeAt(1);
    buf[offset + 2] = fourCC.charCodeAt(2);
    buf[offset + 3] = fourCC.charCodeAt(3);
}

function writeU32LE(buf, offset, value) {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >> 8) & 0xff;
    buf[offset + 2] = (value >> 16) & 0xff;
    buf[offset + 3] = (value >> 24) & 0xff;
}

function writeU24LE(buf, offset, value) {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >> 8) & 0xff;
    buf[offset + 2] = (value >> 16) & 0xff;
}
