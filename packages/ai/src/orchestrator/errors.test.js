import { describe, it, expect } from 'vitest';

import { OrchestratorError, VisionUnavailable, TurnAborted } from './errors.js';

describe('OrchestratorError', () => {
    it('carries name + code and is an Error', () => {
        const e = new OrchestratorError('msg', 'SOME_CODE', { a: 1 });
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('OrchestratorError');
        expect(e.code).toBe('SOME_CODE');
        expect(e.details).toEqual({ a: 1 });
    });
});

describe('VisionUnavailable', () => {
    it('is an OrchestratorError with the active provider/model + VISION_UNAVAILABLE code', () => {
        const e = new VisionUnavailable({ activeProvider: 'ollama', activeModel: 'llama3.2' });
        expect(e).toBeInstanceOf(OrchestratorError);
        expect(e.name).toBe('VisionUnavailable');
        expect(e.code).toBe('VISION_UNAVAILABLE');
        expect(e.activeProvider).toBe('ollama');
        expect(e.activeModel).toBe('llama3.2');
        expect(e.message).toContain('llama3.2');
    });

    it('never embeds key material', () => {
        const e = new VisionUnavailable({ activeProvider: 'ollama', activeModel: 'llama3.2', reason: 'declined' });
        expect(JSON.stringify({ name: e.name, message: e.message, code: e.code })).not.toMatch(/sk-/);
    });
});

describe('TurnAborted', () => {
    it('is an OrchestratorError with TURN_ABORTED code', () => {
        const e = new TurnAborted();
        expect(e).toBeInstanceOf(OrchestratorError);
        expect(e.name).toBe('TurnAborted');
        expect(e.code).toBe('TURN_ABORTED');
    });
});
