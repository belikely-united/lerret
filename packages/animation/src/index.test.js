import { describe, it, expect } from 'vitest';
import {
    AnimationError,
    SUPPORTED_FORMATS,
    RECOMMENDED_FORMAT,
    VERSION,
    createEncoder,
    captureFrames,
    isMp4Supported,
} from './index.js';

describe('@lerret/animation public API', () => {
    it('exposes the four supported formats in a frozen list', () => {
        expect(SUPPORTED_FORMATS).toEqual(['webp', 'gif', 'apng', 'mp4']);
        expect(Object.isFrozen(SUPPORTED_FORMATS)).toBe(true);
    });

    it('recommends webp by default', () => {
        expect(RECOMMENDED_FORMAT).toBe('webp');
        expect(SUPPORTED_FORMATS).toContain(RECOMMENDED_FORMAT);
    });

    it('exports a version string', () => {
        expect(typeof VERSION).toBe('string');
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('exposes the encoder/capture factories as functions', () => {
        expect(typeof createEncoder).toBe('function');
        expect(typeof captureFrames).toBe('function');
        expect(typeof isMp4Supported).toBe('function');
    });

    it('rejects unknown formats from createEncoder with a stable error code', async () => {
        await expect(createEncoder('avif', { width: 100, height: 100 })).rejects.toMatchObject({
            name: 'AnimationError',
            code: 'UNKNOWN_FORMAT',
        });
    });

    it('AnimationError carries name + code + message', () => {
        const err = new AnimationError('boom', 'TEST_CODE');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('AnimationError');
        expect(err.code).toBe('TEST_CODE');
        expect(err.message).toBe('boom');
    });

    it('isMp4Supported returns a boolean', () => {
        const result = isMp4Supported();
        expect(typeof result).toBe('boolean');
    });
});
