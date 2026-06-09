// Tests for the normalized provider error classes.

import { describe, it, expect } from 'vitest';
import {
    ProviderError,
    RateLimited,
    InvalidKey,
    Unreachable,
    BadModel,
    ContentBlocked,
    Unknown,
} from './errors.js';

describe('ProviderError base + subclasses', () => {
    it('base carries vendor / statusCode / originalMessage', () => {
        const err = new ProviderError({
            message: 'something failed',
            vendor: 'openai',
            statusCode: 500,
            originalMessage: 'upstream barfed',
        });
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ProviderError');
        expect(err.message).toBe('something failed');
        expect(err.vendor).toBe('openai');
        expect(err.statusCode).toBe(500);
        expect(err.originalMessage).toBe('upstream barfed');
    });

    it('each subclass extends ProviderError + has the correct name', () => {
        const cases = [
            { Cls: RateLimited, name: 'RateLimited' },
            { Cls: InvalidKey, name: 'InvalidKey' },
            { Cls: Unreachable, name: 'Unreachable' },
            { Cls: BadModel, name: 'BadModel' },
            { Cls: ContentBlocked, name: 'ContentBlocked' },
            { Cls: Unknown, name: 'Unknown' },
        ];
        for (const { Cls, name } of cases) {
            const err = new Cls({ message: 'm', vendor: 'openai' });
            expect(err).toBeInstanceOf(ProviderError);
            expect(err.name).toBe(name);
            expect(err.vendor).toBe('openai');
        }
    });

    it('Unreachable carries optional reason for cors / network branching', () => {
        const cors = new Unreachable({ message: 'm', vendor: 'ollama', reason: 'cors' });
        expect(cors.reason).toBe('cors');
        const network = new Unreachable({ message: 'm', vendor: 'openai', reason: 'network' });
        expect(network.reason).toBe('network');
    });
});
