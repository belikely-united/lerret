/**
 * @lerret/animation — animated-export engine for Lerret.
 *
 * Reached only via `await import('@lerret/animation')` from @lerret/studio and @lerret/cli.
 * A static import of this package from anywhere outside packages/animation/ is an enforced
 * lint/test violation (see no-static-imports.test.js).
 */

/**
 * @typedef {Object} AnimationEncoder
 * @property {(canvas: HTMLCanvasElement | OffscreenCanvas, durationMs: number) => void} addFrame
 *   Add one captured frame to the encoder. `durationMs` is the frame's intended display duration.
 * @property {() => Promise<Blob>} finalize
 *   Finalize the animation and resolve to a Blob of the chosen format.
 */

/**
 * @typedef {'webp' | 'gif' | 'apng' | 'mp4'} AnimationFormat
 */

/**
 * @typedef {Object} EncoderOptions
 * @property {number} width   Output width in pixels.
 * @property {number} height  Output height in pixels.
 * @property {number} [fps]   Target frames per second (default: 24).
 * @property {'infinite' | 'once' | number} [loop]
 *   Loop count: `'infinite'` (default), `'once'`, or an integer for explicit count.
 *   Honored by formats that support it (WebP, GIF, APNG). MP4 ignores `loop`.
 * @property {number} [bitrate]  MP4 only — bits per second. Default ~5_000_000.
 */

/**
 * Create an encoder for the requested animation format.
 * Encoders are constructed lazily — the heavy library payloads only load on demand.
 *
 * @param {AnimationFormat} format
 * @param {EncoderOptions} options
 * @returns {Promise<AnimationEncoder>}
 */
export async function createEncoder(format, options) {
    switch (format) {
        case 'webp': {
            const { createWebpEncoder } = await import('./encoders/webp.js');
            return createWebpEncoder(options);
        }
        case 'gif': {
            const { createGifEncoder } = await import('./encoders/gif.js');
            return createGifEncoder(options);
        }
        case 'apng': {
            const { createApngEncoder } = await import('./encoders/apng.js');
            return createApngEncoder(options);
        }
        case 'mp4': {
            const { createMp4Encoder } = await import('./encoders/mp4.js');
            return createMp4Encoder(options);
        }
        default:
            throw new AnimationError(`Unknown animation format: ${String(format)}`, 'UNKNOWN_FORMAT');
    }
}

/**
 * Capture frames from a DOM element and feed them to an `AnimationEncoder` as
 * they become available — streaming pattern, no full-buffer allocation.
 *
 * @param {Element} element
 * @param {AnimationEncoder} encoder
 * @param {Object} options
 * @param {'now' | 'cycle'} options.mode
 * @param {number} [options.durationMs]   Required for `'now'` mode.
 * @param {number} options.fps
 * @param {number} [options.scale]
 * @param {number} [options.liveRefreshIntervalMs]  Required for `'cycle'` mode.
 * @param {(i: number, total: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Blob>}  The encoded animation, from `encoder.finalize()`.
 */
export async function captureToEncoder(element, encoder, options) {
    const { captureToEncoder: impl } = await import('./frame-capture.js');
    return impl(element, encoder, options);
}

/**
 * Capture a sequence of frames from a DOM element into an in-memory array
 * (no encoder involved). Use for previews and tests.
 *
 * @param {Element} element
 * @param {Object} options  Same shape as `captureToEncoder` minus `encoder`.
 * @returns {Promise<Array<{ canvas: HTMLCanvasElement, durationMs: number }>>}
 */
export async function captureFrames(element, options) {
    const { captureFrames: impl } = await import('./frame-capture.js');
    return impl(element, options);
}

/**
 * Recognised animation format identifiers.
 * Studio dialogs and CLI flag parsers use this list as the source of truth.
 */
export const SUPPORTED_FORMATS = Object.freeze(['webp', 'gif', 'apng', 'mp4']);

/**
 * Recommended default format. WebP wins on a balance of file size, compatibility, and
 * encode speed for short LiveRefresh-style loops.
 * @type {AnimationFormat}
 */
export const RECOMMENDED_FORMAT = 'webp';

/**
 * Error class used by the animation pipeline. Carries a stable `code` so the studio dialog and
 * CLI handlers can branch on the failure mode without parsing message strings.
 */
export class AnimationError extends Error {
    /**
     * @param {string} message
     * @param {string} code  Stable identifier, e.g. 'UNKNOWN_FORMAT', 'WEBCODECS_UNAVAILABLE',
     *                       'INVALID_FRAME', 'ENCODER_FAILED', 'CAPTURE_CANCELLED'.
     */
    constructor(message, code) {
        super(message);
        this.name = 'AnimationError';
        this.code = code;
    }
}

/**
 * Synchronously check whether MP4 encoding is available in the current runtime.
 * Returns `true` when the WebCodecs `VideoEncoder` global is present; the actual encoder
 * still negotiates a working codec config on construction.
 *
 * @returns {boolean}
 */
export function isMp4Supported() {
    return typeof globalThis.VideoEncoder === 'function';
}

/**
 * Package version, for debugging output. Kept in lockstep with package.json by the release script.
 */
export const VERSION = '0.1.0';
