// Tests for the egress URL guards (Story 8.1 code-review CRITICAL fix).

import { describe, it, expect } from 'vitest';

import {
    EgressBlockedError,
    assertVendorOrigin,
    assertLocalOrigin,
} from './url-guard.js';

describe('assertVendorOrigin (cloud BYOK pinning)', () => {
    it('accepts the exact pinned vendor origin', () => {
        expect(assertVendorOrigin('https://api.openai.com', 'https://api.openai.com')).toBe(
            'https://api.openai.com',
        );
    });

    it('accepts the vendor host with a path (normalizes to origin)', () => {
        expect(
            assertVendorOrigin('https://api.openai.com/v1', 'https://api.openai.com'),
        ).toBe('https://api.openai.com');
    });

    it('rejects a different host (the exfiltration vector)', () => {
        expect(() =>
            assertVendorOrigin('https://evil.example', 'https://api.openai.com'),
        ).toThrow(EgressBlockedError);
        expect(() =>
            assertVendorOrigin('https://evil.example', 'https://api.openai.com'),
        ).toThrow(/not the pinned vendor host/);
    });

    it('rejects a look-alike subdomain', () => {
        expect(() =>
            assertVendorOrigin('https://api.openai.com.evil.example', 'https://api.openai.com'),
        ).toThrow(EgressBlockedError);
    });

    it('rejects http (downgrade) for a cloud vendor', () => {
        expect(() =>
            assertVendorOrigin('http://api.openai.com', 'https://api.openai.com'),
        ).toThrow(/https/);
    });

    it('rejects a non-URL string', () => {
        expect(() => assertVendorOrigin('not a url', 'https://api.openai.com')).toThrow(
            EgressBlockedError,
        );
    });

    it('rejects a non-http scheme', () => {
        expect(() =>
            assertVendorOrigin('file:///etc/passwd', 'https://api.openai.com'),
        ).toThrow(EgressBlockedError);
    });

    it('the error carries the attempted URL', () => {
        try {
            assertVendorOrigin('https://evil.example', 'https://api.openai.com');
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(EgressBlockedError);
            expect(err.attemptedUrl).toBe('https://evil.example');
        }
    });
});

describe('assertLocalOrigin (Ollama loopback/private only)', () => {
    it('accepts localhost', () => {
        expect(assertLocalOrigin('http://localhost:11434')).toBe('http://localhost:11434');
    });

    it('accepts IPv4 loopback', () => {
        expect(assertLocalOrigin('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    });

    it('accepts IPv6 loopback', () => {
        expect(assertLocalOrigin('http://[::1]:11434')).toBe('http://[::1]:11434');
    });

    it('accepts RFC-1918 private ranges', () => {
        expect(assertLocalOrigin('http://10.0.0.5:11434')).toBe('http://10.0.0.5:11434');
        expect(assertLocalOrigin('http://172.16.3.4:11434')).toBe('http://172.16.3.4:11434');
        expect(assertLocalOrigin('http://192.168.1.50:11434')).toBe('http://192.168.1.50:11434');
    });

    it('accepts a *.local mDNS host', () => {
        expect(assertLocalOrigin('http://my-nas.local:11434')).toBe('http://my-nas.local:11434');
    });

    it('REJECTS a public host (SSRF / exfiltration)', () => {
        expect(() => assertLocalOrigin('https://evil.example/api/chat')).toThrow(
            EgressBlockedError,
        );
    });

    it('REJECTS a public IP', () => {
        expect(() => assertLocalOrigin('http://8.8.8.8:11434')).toThrow(EgressBlockedError);
    });

    it('REJECTS the 169.254 link-local (cloud-metadata) range', () => {
        expect(() => assertLocalOrigin('http://169.254.169.254/latest/meta-data')).toThrow(
            EgressBlockedError,
        );
    });

    it('REJECTS 172.x outside the 16-31 private band', () => {
        expect(() => assertLocalOrigin('http://172.15.0.1:11434')).toThrow(EgressBlockedError);
        expect(() => assertLocalOrigin('http://172.32.0.1:11434')).toThrow(EgressBlockedError);
    });

    it('REJECTS a non-http scheme', () => {
        expect(() => assertLocalOrigin('file:///etc/passwd')).toThrow(EgressBlockedError);
    });

    it('REJECTS an invalid IPv4 (octet > 255)', () => {
        expect(() => assertLocalOrigin('http://10.0.0.999:11434')).toThrow(EgressBlockedError);
    });
});
