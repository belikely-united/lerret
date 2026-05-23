// encoders/mp4.js — MP4 encoder via browser-native WebCodecs + mp4-muxer.
//
// Strategy:
//  1. `VideoEncoder` (WebCodecs API) encodes each Canvas frame as H.264.
//  2. `mp4-muxer` wraps the encoded chunks into an MP4 container in-memory.
//
// Zero WASM payload, hardware-accelerated where the device supports it.
// Substantially faster than ffmpeg.wasm; ~30 KB of muxer JS.
//
// Browser support: WebCodecs `VideoEncoder` requires Chromium 94+, Safari 16.4+,
// Firefox 130+. Lerret's hosted-mode floor is already Chromium 86+ (FSA), so
// MP4 works on every browser Lerret already supports. Unsupported browsers
// receive an `AnimationError` with code `WEBCODECS_UNAVAILABLE` which the
// studio dialog and CLI translate into honest degradation messaging.

import { AnimationError } from '../index.js';

// Default codec configuration — H.264 main profile, 5 Mbps, 2-second keyframe.
// Centralized here so the device-matrix fallback path (Story 7.6 acceptance
// criterion) has a single place to edit. The "main" profile (avc1.4d0028 →
// 0x4d = main, level 4.0) plays in every modern player.
const DEFAULT_CODEC_CONFIG = {
    // avc1.4d0028 = H.264 Main Profile, Level 4.0 — broad device support.
    codec: 'avc1.4d0028',
    bitrate: 5_000_000,
    avc: { format: 'avc' },
};

const FALLBACK_CODEC_CONFIG = {
    // avc1.42001f = H.264 Baseline Profile, Level 3.1 — even broader playback.
    codec: 'avc1.42001f',
    bitrate: 3_000_000,
    avc: { format: 'avc' },
};

/**
 * @param {import('../index.js').EncoderOptions} options
 * @returns {Promise<import('../index.js').AnimationEncoder>}
 */
export async function createMp4Encoder(options) {
    const { width, height, fps = 24, bitrate } = options;

    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new AnimationError(
            'MP4 encoder: width/height must be positive integers',
            'INVALID_FRAME',
        );
    }

    if (typeof globalThis.VideoEncoder !== 'function') {
        throw new AnimationError(
            'MP4 export needs WebCodecs — supported in Chromium 94+, Safari 16.4+, Firefox 130+. ' +
                'Try WebP / GIF / APNG instead.',
            'WEBCODECS_UNAVAILABLE',
        );
    }

    // Lazy-import mp4-muxer (kept inside @lerret/animation; lazy so the studio
    // bundle doesn't pull it on cold start — only when the dialog opens).
    const muxerMod = await import('mp4-muxer');
    const { Muxer, ArrayBufferTarget } = muxerMod;

    const codecConfig = await pickWorkingCodecConfig({ width, height, fps, bitrate });
    if (codecConfig === null) {
        throw new AnimationError(
            'MP4 encoder: no supported H.264 configuration found on this device. ' +
                'Try a different format (WebP/GIF/APNG) or contact support.',
            'ENCODER_FAILED',
        );
    }

    const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
            codec: 'avc',
            width,
            height,
            frameRate: fps,
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
    });

    /** @type {VideoEncoder} */
    const videoEncoder = new globalThis.VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => {
            // Surface as an AnimationError in the next addFrame / finalize call.
            encoderError = new AnimationError(
                `MP4 encoder: VideoEncoder reported "${err && err.message ? err.message : String(err)}"`,
                'ENCODER_FAILED',
            );
        },
    });
    videoEncoder.configure({
        codec: codecConfig.codec,
        width,
        height,
        bitrate: codecConfig.bitrate,
        framerate: fps,
        avc: codecConfig.avc,
    });

    /** @type {AnimationError | null} */
    let encoderError = null;
    let nextTimestampUs = 0;
    let frameCount = 0;
    const keyframeInterval = Math.max(1, fps * 2); // 2-second keyframes

    return {
        addFrame(canvas, durationMs) {
            if (encoderError) throw encoderError;
            if (!canvas || (typeof canvas.getContext !== 'function' && !(canvas instanceof OffscreenCanvas))) {
                throw new AnimationError('MP4 encoder: addFrame requires a Canvas', 'INVALID_FRAME');
            }
            const durationUs = Math.max(1, Math.round(durationMs * 1000));
            // VideoFrame from a canvas — the WebCodecs API accepts canvases
            // directly as ImageBitmapSource.
            // eslint-disable-next-line no-undef
            const videoFrame = new VideoFrame(canvas, {
                timestamp: nextTimestampUs,
                duration: durationUs,
            });
            try {
                videoEncoder.encode(videoFrame, {
                    keyFrame: frameCount % keyframeInterval === 0,
                });
            } finally {
                videoFrame.close();
            }
            nextTimestampUs += durationUs;
            frameCount += 1;
        },
        async finalize() {
            if (frameCount === 0) {
                throw new AnimationError('MP4 encoder: no frames added', 'INVALID_FRAME');
            }
            try {
                await videoEncoder.flush();
            } catch (err) {
                throw new AnimationError(
                    `MP4 encoder: flush failed: ${err && err.message ? err.message : String(err)}`,
                    'ENCODER_FAILED',
                );
            }
            if (encoderError) throw encoderError;
            videoEncoder.close();
            muxer.finalize();
            const buffer = muxer.target.buffer;
            return new Blob([buffer], { type: 'video/mp4' });
        },
    };
}

/**
 * Probe `VideoEncoder.isConfigSupported` to find a working codec configuration
 * for the requested dimensions. Tries the default profile first, then falls
 * back to Baseline if Main isn't supported on this device.
 *
 * @param {{ width: number, height: number, fps: number, bitrate?: number }} args
 * @returns {Promise<{ codec: string, bitrate: number, avc: { format: 'avc' } } | null>}
 */
async function pickWorkingCodecConfig({ width, height, fps, bitrate }) {
    const VideoEncoderCtor = globalThis.VideoEncoder;
    if (typeof VideoEncoderCtor?.isConfigSupported !== 'function') {
        // Older builds without isConfigSupported — assume the default works.
        return { ...DEFAULT_CODEC_CONFIG, bitrate: bitrate ?? DEFAULT_CODEC_CONFIG.bitrate };
    }

    for (const candidate of [DEFAULT_CODEC_CONFIG, FALLBACK_CODEC_CONFIG]) {
        try {
            const result = await VideoEncoderCtor.isConfigSupported({
                codec: candidate.codec,
                width,
                height,
                bitrate: bitrate ?? candidate.bitrate,
                framerate: fps,
                avc: candidate.avc,
            });
            if (result && result.supported) {
                return { ...candidate, bitrate: bitrate ?? candidate.bitrate };
            }
        } catch {
            // Continue to the next candidate.
        }
    }
    return null;
}
