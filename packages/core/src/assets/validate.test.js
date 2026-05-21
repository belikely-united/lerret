// validate.test.js — pure validateProps function.
//
// Verifies all documented failure conditions and confirms pure/non-throwing
// behavior for every edge case.

import { describe, it, expect } from 'vitest';
import { validateProps } from './validate.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convenience: extract just the `prop` names from failures. */
function failingProps(resolved, schema) {
  return validateProps(resolved, schema).map((f) => f.prop);
}

// ── Guard: invalid arguments ──────────────────────────────────────────────────

describe('validateProps — invalid arguments', () => {
  it('returns [] for null resolvedProps', () => {
    expect(validateProps(null, { a: { type: 'string', required: true } })).toEqual([]);
  });
  it('returns [] for array resolvedProps', () => {
    expect(validateProps([], { a: { type: 'string' } })).toEqual([]);
  });
  it('returns [] for null propsSchema', () => {
    expect(validateProps({ a: 'hello' }, null)).toEqual([]);
  });
  it('returns [] for array propsSchema', () => {
    expect(validateProps({ a: 'hello' }, [])).toEqual([]);
  });
  it('returns [] for both absent', () => {
    expect(validateProps({}, {})).toEqual([]);
  });
});

// ── required ─────────────────────────────────────────────────────────────────

describe('required check', () => {
  const schema = { headline: { type: 'string', required: true } };

  it('flags when required prop is absent (undefined)', () => {
    const result = validateProps({}, schema);
    expect(result).toHaveLength(1);
    expect(result[0].prop).toBe('headline');
    expect(result[0].reason).toMatch(/required/i);
  });

  it('passes when required prop is present', () => {
    expect(validateProps({ headline: 'Hello' }, schema)).toEqual([]);
  });

  it('does NOT flag absent prop when not required', () => {
    const s = { subhead: { type: 'string' } };
    expect(validateProps({}, s)).toEqual([]);
  });
});

// ── string type ───────────────────────────────────────────────────────────────

describe('string type check', () => {
  const schema = { title: { type: 'string' } };

  it('passes for a string value', () => {
    expect(validateProps({ title: 'ok' }, schema)).toEqual([]);
  });

  it('passes when absent and not required', () => {
    expect(validateProps({}, schema)).toEqual([]);
  });

  it('fails for a number value', () => {
    expect(failingProps({ title: 42 }, schema)).toContain('title');
  });

  it('fails for a boolean value', () => {
    expect(failingProps({ title: true }, schema)).toContain('title');
  });

  it('fails for an array value', () => {
    const result = validateProps({ title: [] }, schema);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toMatch(/array/i);
  });
});

// ── number type ───────────────────────────────────────────────────────────────

describe('number type check', () => {
  const schema = { count: { type: 'number' } };

  it('passes for a finite number', () => {
    expect(validateProps({ count: 5 }, schema)).toEqual([]);
  });

  it('fails for a string', () => {
    expect(failingProps({ count: '5' }, schema)).toContain('count');
  });

  it('fails for NaN', () => {
    expect(failingProps({ count: NaN }, schema)).toContain('count');
  });

  it('fails for Infinity', () => {
    expect(failingProps({ count: Infinity }, schema)).toContain('count');
  });

  it('passes 0 as a valid number', () => {
    expect(validateProps({ count: 0 }, schema)).toEqual([]);
  });
});

// ── number min/max bounds ─────────────────────────────────────────────────────

describe('number min/max bounds', () => {
  const schema = { size: { type: 'number', min: 1, max: 10 } };

  it('passes when within bounds', () => {
    expect(validateProps({ size: 5 }, schema)).toEqual([]);
  });

  it('passes when equal to min', () => {
    expect(validateProps({ size: 1 }, schema)).toEqual([]);
  });

  it('passes when equal to max', () => {
    expect(validateProps({ size: 10 }, schema)).toEqual([]);
  });

  it('fails when below min', () => {
    const result = validateProps({ size: 0 }, schema);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toMatch(/at least 1/i);
  });

  it('fails when above max', () => {
    const result = validateProps({ size: 11 }, schema);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toMatch(/at most 10/i);
  });
});

// ── boolean type ──────────────────────────────────────────────────────────────

describe('boolean type check', () => {
  const schema = { visible: { type: 'boolean' } };

  it('passes true', () => {
    expect(validateProps({ visible: true }, schema)).toEqual([]);
  });

  it('passes false', () => {
    expect(validateProps({ visible: false }, schema)).toEqual([]);
  });

  it('fails for string "true"', () => {
    expect(failingProps({ visible: 'true' }, schema)).toContain('visible');
  });

  it('fails for a number', () => {
    expect(failingProps({ visible: 1 }, schema)).toContain('visible');
  });
});

// ── select type ───────────────────────────────────────────────────────────────

describe('select type check', () => {
  const schema = {
    tone: { type: 'select', options: ['warm', 'cool', 'mono'] },
  };

  it('passes when value is in options', () => {
    expect(validateProps({ tone: 'warm' }, schema)).toEqual([]);
  });

  it('fails when value is NOT in options', () => {
    const result = validateProps({ tone: 'dark' }, schema);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toMatch(/warm, cool, mono/);
  });

  it('fails when options is absent', () => {
    const s = { tone: { type: 'select' } };
    const result = validateProps({ tone: 'anything' }, s);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toMatch(/no options/i);
  });

  it('passes when absent and not required', () => {
    expect(validateProps({}, schema)).toEqual([]);
  });
});

// ── unknown type ──────────────────────────────────────────────────────────────

describe('unknown type', () => {
  it('does not flag an unknown type as a mismatch', () => {
    const schema = { custom: { type: 'richtext' } };
    expect(validateProps({ custom: 42 }, schema)).toEqual([]);
  });
});

// ── malformed schema descriptor ───────────────────────────────────────────────

describe('malformed schema descriptor', () => {
  it('skips a null descriptor without throwing', () => {
    expect(validateProps({ a: 'ok' }, { a: null })).toEqual([]);
  });
  it('skips an array descriptor without throwing', () => {
    expect(validateProps({ a: 'ok' }, { a: ['string'] })).toEqual([]);
  });
  it('skips a string descriptor without throwing', () => {
    expect(validateProps({ a: 'ok' }, { a: 'string' })).toEqual([]);
  });
  it('does not let a bad descriptor suppress other fields', () => {
    const schema = {
      bad: null,
      title: { type: 'string', required: true },
    };
    const result = validateProps({}, schema);
    expect(result).toHaveLength(1);
    expect(result[0].prop).toBe('title');
  });
});

// ── multiple failures ─────────────────────────────────────────────────────────

describe('multiple failures', () => {
  it('reports all failing fields', () => {
    const schema = {
      a: { type: 'string', required: true },
      b: { type: 'number', min: 5 },
      c: { type: 'boolean' },
    };
    const resolved = {
      // a: absent (required → fail)
      b: 2,        // below min → fail
      c: 'yes',    // wrong type → fail
    };
    const result = validateProps(resolved, schema);
    expect(result).toHaveLength(3);
    expect(result.map((f) => f.prop)).toEqual(['a', 'b', 'c']);
  });
});

// ── no failures ───────────────────────────────────────────────────────────────

describe('no failures', () => {
  it('returns [] when all props satisfy the schema', () => {
    const schema = {
      headline: { type: 'string', required: true },
      count: { type: 'number', min: 0 },
      tone: { type: 'select', options: ['warm', 'cool'] },
      visible: { type: 'boolean' },
    };
    const resolved = {
      headline: 'Hello',
      count: 3,
      tone: 'warm',
      visible: false,
    };
    expect(validateProps(resolved, schema)).toEqual([]);
  });
});
