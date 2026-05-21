// validate.test.js — unit tests for the validateField helper.
//
// Pure function — no DOM, no React. Runs in jsdom but doesn't need it.

import { describe, it, expect } from 'vitest';
import { validateField } from './validate.js';

describe('validateField — string', () => {
 it('is valid for a string value', () => {
 expect(validateField('hello', { type: 'string' }).valid).toBe(true);
 });

 it('is invalid for a non-string value', () => {
 const r = validateField(42, { type: 'string' });
 expect(r.valid).toBe(false);
 expect(r.message).toBeTruthy();
 });

 it('is valid when absent and not required', () => {
 expect(validateField(undefined, { type: 'string' }).valid).toBe(true);
 expect(validateField(null, { type: 'string' }).valid).toBe(true);
 expect(validateField('', { type: 'string' }).valid).toBe(true);
 });

 it('is invalid when absent and required', () => {
 const r = validateField(undefined, { type: 'string', required: true });
 expect(r.valid).toBe(false);
 expect(r.message).toMatch(/required/i);
 });
});

describe('validateField — number', () => {
 it('is valid for a finite number', () => {
 expect(validateField(42, { type: 'number' }).valid).toBe(true);
 expect(validateField(0, { type: 'number' }).valid).toBe(true);
 expect(validateField(-3.14, { type: 'number' }).valid).toBe(true);
 });

 it('is invalid for NaN', () => {
 expect(validateField(NaN, { type: 'number' }).valid).toBe(false);
 });

 it('is invalid for Infinity', () => {
 expect(validateField(Infinity, { type: 'number' }).valid).toBe(false);
 });

 it('is invalid for a string', () => {
 expect(validateField('42', { type: 'number' }).valid).toBe(false);
 });

 it('flags values below min', () => {
 const r = validateField(3, { type: 'number', min: 5 });
 expect(r.valid).toBe(false);
 expect(r.message).toMatch(/at least 5/i);
 });

 it('flags values above max', () => {
 const r = validateField(100, { type: 'number', max: 50 });
 expect(r.valid).toBe(false);
 expect(r.message).toMatch(/at most 50/i);
 });

 it('accepts value at the boundary', () => {
 expect(validateField(5, { type: 'number', min: 5, max: 10 }).valid).toBe(true);
 expect(validateField(10, { type: 'number', min: 5, max: 10 }).valid).toBe(true);
 });

 it('is invalid when absent and required', () => {
 const r = validateField(undefined, { type: 'number', required: true });
 expect(r.valid).toBe(false);
 });
});

describe('validateField — boolean', () => {
 it('is valid for true/false', () => {
 expect(validateField(true, { type: 'boolean' }).valid).toBe(true);
 expect(validateField(false, { type: 'boolean' }).valid).toBe(true);
 });

 it('is invalid for non-boolean', () => {
 expect(validateField(1, { type: 'boolean' }).valid).toBe(false);
 expect(validateField('true', { type: 'boolean' }).valid).toBe(false);
 });

 it('is valid when absent and not required', () => {
 expect(validateField(undefined, { type: 'boolean' }).valid).toBe(true);
 });
});

describe('validateField — select', () => {
 const schema = { type: 'select', options: ['red', 'green', 'blue'] };

 it('is valid for a value in options', () => {
 expect(validateField('red', schema).valid).toBe(true);
 expect(validateField('blue', schema).valid).toBe(true);
 });

 it('is invalid for a value not in options', () => {
 const r = validateField('yellow', schema);
 expect(r.valid).toBe(false);
 expect(r.message).toContain('red');
 });

 it('is valid when absent and not required', () => {
 expect(validateField(undefined, schema).valid).toBe(true);
 });

 it('is invalid when absent and required', () => {
 const r = validateField(undefined, { ...schema, required: true });
 expect(r.valid).toBe(false);
 });
});

describe('validateField — array', () => {
 it('is valid for an array', () => {
 expect(validateField([], { type: 'array' }).valid).toBe(true);
 expect(validateField([1, 2, 3], { type: 'array' }).valid).toBe(true);
 });

 it('is invalid for a non-array', () => {
 expect(validateField({}, { type: 'array' }).valid).toBe(false);
 expect(validateField('list', { type: 'array' }).valid).toBe(false);
 });

 it('is valid when absent and not required', () => {
 expect(validateField(undefined, { type: 'array' }).valid).toBe(true);
 });
});

describe('validateField — object', () => {
 it('is valid for a plain object', () => {
 expect(validateField({}, { type: 'object' }).valid).toBe(true);
 expect(validateField({ a: 1 }, { type: 'object' }).valid).toBe(true);
 });

 it('is invalid for an array', () => {
 expect(validateField([], { type: 'object' }).valid).toBe(false);
 });

 it('is invalid for a string', () => {
 expect(validateField('obj', { type: 'object' }).valid).toBe(false);
 });

 it('is valid when absent and not required', () => {
 expect(validateField(undefined, { type: 'object' }).valid).toBe(true);
 });
});

describe('validateField — edge cases', () => {
 it('returns valid when schema is null/undefined', () => {
 expect(validateField('anything', null).valid).toBe(true);
 expect(validateField('anything', undefined).valid).toBe(true);
 });

 it('returns valid for unknown type', () => {
 expect(validateField('anything', { type: 'exotic' }).valid).toBe(true);
 });

 it('invalid result always carries a non-empty message', () => {
 const r = validateField(NaN, { type: 'number' });
 expect(r.valid).toBe(false);
 expect(typeof r.message).toBe('string');
 expect(r.message.length).toBeGreaterThan(0);
 });
});
