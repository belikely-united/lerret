import { describe, it, expect } from 'vitest';

import {
    TURN_EVENT_TYPES,
    thinking,
    phase,
    reading,
    writing,
    deleting,
    mkdir,
    toolCall,
    inspectorResponse,
    clarifyingNote,
    done,
    error,
    stopped,
    needsVisionFallback,
    turnProgress,
    needsContinue,
} from './events.js';

describe('TURN_EVENT_TYPES', () => {
    it('is a frozen array of the canonical event type strings', () => {
        expect(Object.isFrozen(TURN_EVENT_TYPES)).toBe(true);
        expect(TURN_EVENT_TYPES).toContain('thinking');
        expect(TURN_EVENT_TYPES).toContain('needs-vision-fallback');
        expect(TURN_EVENT_TYPES).toContain('stopped');
        expect(TURN_EVENT_TYPES).toContain('inspector-response');
        expect(TURN_EVENT_TYPES).toContain('phase');
    });
});

describe('phase event (Epic 9 follow-up — orchestration visibility)', () => {
    it('carries the user-facing progress slug, frozen, never a node class name', () => {
        const ev = phase('brand');
        expect(ev).toEqual({ type: 'phase', phase: 'brand' });
        expect(Object.isFrozen(ev)).toBe(true);
        // The vocabulary is decoupled from the graph topology: no internal node
        // class name ever appears in a phase payload.
        for (const slug of ['understanding', 'context', 'brand', 'working', 'exploring']) {
            expect(phase(slug).phase).toBe(slug);
        }
        expect(phase(undefined).phase).toBe('');
    });
});

describe('event factories', () => {
    it('every factory yields a frozen object whose type is in TURN_EVENT_TYPES', () => {
        const samples = [
            thinking(),
            phase('working'),
            reading('a'),
            writing('b'),
            deleting('c'),
            mkdir('d'),
            toolCall('inspect'),
            inspectorResponse('the project has 3 pages'),
            done([{ path: 'x', op: 'create' }]),
            error(new Error('boom')),
            stopped(),
            needsVisionFallback([{ name: 'anthropic', model: 'claude-opus-4-7' }]),
            turnProgress(3, 10, 12400),
            needsContinue(10, 48210),
        ];
        for (const ev of samples) {
            expect(Object.isFrozen(ev)).toBe(true);
            expect(TURN_EVENT_TYPES).toContain(ev.type);
        }
    });

    it('reading/writing/deleting carry the file; mkdir carries the dir', () => {
        expect(reading('p.jsx')).toMatchObject({ type: 'reading', file: 'p.jsx' });
        expect(writing('p.jsx')).toMatchObject({ type: 'writing', file: 'p.jsx' });
        expect(deleting('p.jsx')).toMatchObject({ type: 'deleting', file: 'p.jsx' });
        expect(mkdir('d')).toMatchObject({ type: 'mkdir', dir: 'd' });
    });

    it('inspectorResponse carries the answer text verbatim, frozen', () => {
        const answer = 'ReleaseCard.jsx lives at .lerret/social/ReleaseCard.jsx';
        const ev = inspectorResponse(answer);
        expect(ev).toEqual({ type: 'inspector-response', answer });
        expect(Object.isFrozen(ev)).toBe(true);
    });

    it('inspectorResponse coerces non-string input to a string (never a non-string payload)', () => {
        expect(inspectorResponse(undefined).answer).toBe('');
        expect(inspectorResponse(null).answer).toBe('');
        expect(inspectorResponse(42).answer).toBe('42');
    });

    it('done carries a frozen files array', () => {
        const ev = done([{ path: 'a', op: 'create' }, { path: 'b', op: 'edit' }]);
        expect(ev.files).toHaveLength(2);
        expect(Object.isFrozen(ev.files)).toBe(true);
    });

    it('done carries the manifest turnId ONLY when provided as a string', () => {
        const withId = done([{ path: 'a', op: 'create' }], 'turn-abc-123');
        expect(withId.turnId).toBe('turn-abc-123');
        expect(Object.isFrozen(withId)).toBe(true);
        // Omitted / non-string → the historical shape, no turnId key at all.
        expect(done([])).not.toHaveProperty('turnId');
        expect(done([], 42)).not.toHaveProperty('turnId');
    });

    it('stopped carries the manifest turnId ONLY when provided as a string', () => {
        const withId = stopped('turn-abc-123');
        expect(withId).toMatchObject({ type: 'stopped', turnId: 'turn-abc-123' });
        expect(Object.isFrozen(withId)).toBe(true);
        expect(stopped()).not.toHaveProperty('turnId');
        expect(stopped(42)).not.toHaveProperty('turnId');
    });

    it('error normalizes any thrown value to {class, message} and never leaks extra fields', () => {
        const e = new Error('rate');
        e.name = 'RateLimited';
        e.apiKey = 'sk-secret';
        const ev = error(e);
        expect(ev.error).toEqual({ class: 'RateLimited', message: 'rate' });
        expect(JSON.stringify(ev)).not.toContain('sk-secret');
    });

    it('error handles non-Error throws', () => {
        expect(error('plain string').error).toEqual({ class: 'Error', message: 'plain string' });
    });

    it('needsVisionFallback carries requiredCapability + a frozen eligibleProviders', () => {
        const ev = needsVisionFallback([{ name: 'openai', model: 'gpt-4o' }]);
        expect(ev.requiredCapability).toBe('vision');
        expect(Object.isFrozen(ev.eligibleProviders)).toBe(true);
        expect(ev.eligibleProviders[0]).toMatchObject({ name: 'openai', model: 'gpt-4o' });
    });
});

describe('clarifyingNote (DS Curator conflict surface)', () => {
    it('builds the frozen clarifying-note event with optional structured details', () => {
        const ev = clarifyingNote('A and B disagree on brand — using A.', {
            token: 'brand',
            designSystemValue: '#B85B33',
            configValue: '#FF0000',
        });
        expect(ev).toEqual({
            type: 'clarifying-note',
            note: 'A and B disagree on brand — using A.',
            token: 'brand',
            designSystemValue: '#B85B33',
            configValue: '#FF0000',
        });
        expect(Object.isFrozen(ev)).toBe(true);
        expect(TURN_EVENT_TYPES).toContain('clarifying-note');
    });

    it('omits absent details and coerces a non-string note', () => {
        expect(clarifyingNote('just a note')).toEqual({ type: 'clarifying-note', note: 'just a note' });
        expect(clarifyingNote(undefined).note).toBe('');
    });
});

describe('loop events (Story 9.1 — turn-progress / needs-continue)', () => {
    it('turnProgress carries turn/maxTurns/spentTokens, frozen, type registered', () => {
        const ev = turnProgress(3, 10, 12400);
        expect(ev).toEqual({ type: 'turn-progress', turn: 3, maxTurns: 10, spentTokens: 12400 });
        expect(Object.isFrozen(ev)).toBe(true);
        expect(TURN_EVENT_TYPES).toContain('turn-progress');
    });

    it('turnProgress coerces via Number() and normalizes NaN to 0', () => {
        expect(turnProgress('3', '10', '99')).toEqual({
            type: 'turn-progress',
            turn: 3,
            maxTurns: 10,
            spentTokens: 99,
        });
        expect(turnProgress(undefined, 'not-a-number', NaN)).toEqual({
            type: 'turn-progress',
            turn: 0,
            maxTurns: 0,
            spentTokens: 0,
        });
    });

    it('needsContinue carries turnsUsed/spentTokens, frozen, type registered', () => {
        const ev = needsContinue(10, 48210);
        expect(ev).toEqual({ type: 'needs-continue', turnsUsed: 10, spentTokens: 48210 });
        expect(Object.isFrozen(ev)).toBe(true);
        expect(TURN_EVENT_TYPES).toContain('needs-continue');
    });

    it('needsContinue coerces via Number() and normalizes NaN to 0', () => {
        expect(needsContinue('10', undefined)).toEqual({
            type: 'needs-continue',
            turnsUsed: 10,
            spentTokens: 0,
        });
    });
});

describe('done — Epic 9 summary', () => {
    it('carries a trimmed summary when provided; omits it when empty/absent', async () => {
        const { done } = await import('./events.js');
        expect(done([], 't1', '  Created the banner.  ').summary).toBe('Created the banner.');
        expect(done([], 't1')).not.toHaveProperty('summary');
        expect(done([], 't1', '   ')).not.toHaveProperty('summary');
        expect(done([], undefined, 'No revert target still summarizes.').summary).toBeDefined();
    });
});
