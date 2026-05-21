// Tests for `resolveProps` (FR24).
//
// All tests are pure — no filesystem access, no DOM, no Node built-ins.
// No `console` side-effects to spy on (resolveProps is silent).
//
// Coverage map:
//
//  (a) Each tier in isolation winning when alone:
//        data-only, vars-only, schema-only, all-empty → {}
//
//  (b) Every collision combination — highest tier wins:
//        data over vars, data over schema, vars over schema,
//        data over both vars and schema simultaneously
//
//  (c) Per-prop independence:
//        one prop from data, another from vars, another from schema — all in
//        the same returned object
//
//  (d) All-empty case → {}
//
//  (e) data is null / non-object → treated as empty (tier 1 contributes nothing)
//
//  (f) vars or propsSchema missing (undefined) → no error, lower tiers apply

import { describe, it, expect } from 'vitest';

import { resolveProps } from './resolve-props.js';

// ---------------------------------------------------------------------------
// (a) Each tier in isolation
// ---------------------------------------------------------------------------

describe('resolveProps — (a) single tier wins when alone', () => {
  it('returns data props when only data is provided', () => {
    const result = resolveProps({
      data: { title: 'From data', count: 42 },
    });
    expect(result).toEqual({ title: 'From data', count: 42 });
  });

  it('returns vars props when only vars is provided', () => {
    const result = resolveProps({
      vars: { accent: '#ff0', size: 'lg' },
    });
    expect(result).toEqual({ accent: '#ff0', size: 'lg' });
  });

  it('returns schema defaults when only propsSchema is provided', () => {
    const result = resolveProps({
      propsSchema: {
        title: { type: 'string', default: 'Untitled' },
        count: { type: 'number', default: 0 },
        visible: { type: 'boolean', default: true },
      },
    });
    expect(result).toEqual({ title: 'Untitled', count: 0, visible: true });
  });

  it('a schema prop without a `default` key contributes nothing (tier 4 applies)', () => {
    const result = resolveProps({
      propsSchema: {
        title: { type: 'string', default: 'Hello' },
        color: { type: 'string' }, // no default
      },
    });
    // 'color' is NOT in the result — component default applies
    expect(result).toEqual({ title: 'Hello' });
    expect('color' in result).toBe(false);
  });

  it('a schema prop whose descriptor is not a plain object contributes nothing', () => {
    const result = resolveProps({
      propsSchema: {
        label: 'not-an-object', // not a descriptor object
        title: { type: 'string', default: 'Hi' },
      },
    });
    expect(result).toEqual({ title: 'Hi' });
    expect('label' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Collision / precedence combinations
// ---------------------------------------------------------------------------

describe('resolveProps — (b) tier collision: highest wins', () => {
  it('data wins over vars for the same prop', () => {
    const result = resolveProps({
      data: { title: 'From data' },
      vars: { title: 'From vars' },
    });
    expect(result.title).toBe('From data');
  });

  it('data wins over schema default for the same prop', () => {
    const result = resolveProps({
      data: { title: 'From data' },
      propsSchema: { title: { type: 'string', default: 'Schema default' } },
    });
    expect(result.title).toBe('From data');
  });

  it('vars win over schema default for the same prop', () => {
    const result = resolveProps({
      vars: { title: 'From vars' },
      propsSchema: { title: { type: 'string', default: 'Schema default' } },
    });
    expect(result.title).toBe('From vars');
  });

  it('data wins over both vars AND schema default simultaneously', () => {
    const result = resolveProps({
      data: { title: 'From data' },
      vars: { title: 'From vars' },
      propsSchema: { title: { type: 'string', default: 'Schema default' } },
    });
    expect(result.title).toBe('From data');
  });

  it('vars win when data tier is absent for a prop but vars has it', () => {
    const result = resolveProps({
      data: { count: 10 }, // 'title' not in data
      vars: { title: 'From vars' },
      propsSchema: { title: { type: 'string', default: 'Schema default' } },
    });
    expect(result.title).toBe('From vars'); // vars wins for 'title'
    expect(result.count).toBe(10); // data wins for 'count'
  });

  it('schema default wins when neither data nor vars supply the prop', () => {
    const result = resolveProps({
      data: { count: 5 },
      vars: { count: 99 },
      propsSchema: {
        count: { type: 'number', default: 0 },
        label: { type: 'string', default: 'Default label' }, // not in data/vars
      },
    });
    expect(result.count).toBe(5); // data wins
    expect(result.label).toBe('Default label'); // schema wins
  });

  it('data can supply a falsy value (false, 0, empty string) and it still wins', () => {
    const result = resolveProps({
      data: { visible: false, count: 0, label: '' },
      vars: { visible: true, count: 99, label: 'From vars' },
      propsSchema: {
        visible: { default: true },
        count: { default: 42 },
        label: { default: 'Schema' },
      },
    });
    expect(result.visible).toBe(false);
    expect(result.count).toBe(0);
    expect(result.label).toBe('');
  });

  it('vars can supply a falsy value (null) and it still wins over schema', () => {
    const result = resolveProps({
      vars: { color: null },
      propsSchema: { color: { default: '#fff' } },
    });
    expect(result.color).toBeNull();
  });

  it('schema default of undefined is treated as "explicitly set" (the prop appears in result)', () => {
    // A descriptor with `default: undefined` means the author explicitly set
    // undefined as the default — the prop is included in the result.
    const result = resolveProps({
      propsSchema: {
        badge: { type: 'string', default: undefined },
      },
    });
    // 'badge' IS in the result (default was explicitly declared as undefined)
    expect(Object.prototype.hasOwnProperty.call(result, 'badge')).toBe(true);
    expect(result.badge).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (c) Per-prop independence
// ---------------------------------------------------------------------------

describe('resolveProps — (c) per-prop independence', () => {
  it('each prop independently takes its value from the highest tier that supplies it', () => {
    const result = resolveProps({
      data: { title: 'From data' },
      vars: { accent: 'blue' },
      propsSchema: {
        title: { type: 'string', default: 'Schema title' }, // data wins for this
        accent: { type: 'string', default: 'black' }, // vars wins for this
        size: { type: 'string', default: 'md' }, // schema wins for this
      },
    });

    expect(result.title).toBe('From data'); // tier 1
    expect(result.accent).toBe('blue'); // tier 2
    expect(result.size).toBe('md'); // tier 3
    expect(Object.keys(result)).toHaveLength(3);
  });

  it('a prop absent from all tiers is not in the result (tier 4 — component default)', () => {
    const result = resolveProps({
      data: { title: 'hello' },
      vars: { title: 'hi' },
      propsSchema: { title: { default: 'default' } },
      // 'invisible' appears in none of the tiers
    });
    expect('invisible' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) All-empty → {}
// ---------------------------------------------------------------------------

describe('resolveProps — (d) all tiers empty / absent', () => {
  it('returns {} when called with no arguments', () => {
    expect(resolveProps()).toEqual({});
  });

  it('returns {} when all tiers are undefined', () => {
    expect(resolveProps({ data: undefined, vars: undefined, propsSchema: undefined })).toEqual({});
  });

  it('returns {} when all tiers are null', () => {
    expect(resolveProps({ data: null, vars: null, propsSchema: null })).toEqual({});
  });

  it('returns {} when all tier objects are empty {}', () => {
    expect(resolveProps({ data: {}, vars: {}, propsSchema: {} })).toEqual({});
  });

  it('does not throw; the result is always a plain object (NFR8)', () => {
    expect(() => resolveProps()).not.toThrow();
    expect(typeof resolveProps()).toBe('object');
    expect(Array.isArray(resolveProps())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) data is null / non-object → treated as empty
// ---------------------------------------------------------------------------

describe('resolveProps — (e) non-object data is treated as empty', () => {
  it('null data contributes nothing; vars and schema still apply', () => {
    const result = resolveProps({
      data: null,
      vars: { accent: 'red' },
      propsSchema: { label: { default: 'hi' } },
    });
    expect(result).toEqual({ accent: 'red', label: 'hi' });
  });

  it('array data contributes nothing', () => {
    const result = resolveProps({
      data: [{ title: 'item' }],
      vars: { title: 'From vars' },
    });
    expect(result.title).toBe('From vars');
  });

  it('string data contributes nothing', () => {
    const result = resolveProps({
      data: 'just a string',
      vars: { count: 7 },
    });
    expect(result).toEqual({ count: 7 });
  });

  it('number data contributes nothing', () => {
    const result = resolveProps({
      data: 42,
      propsSchema: { color: { default: 'blue' } },
    });
    expect(result).toEqual({ color: 'blue' });
  });

  it('boolean data contributes nothing', () => {
    const result = resolveProps({
      data: true,
      vars: { label: 'hello' },
    });
    expect(result).toEqual({ label: 'hello' });
  });

  it('undefined data contributes nothing (same as absent)', () => {
    const result = resolveProps({
      data: undefined,
      vars: { size: 'lg' },
    });
    expect(result).toEqual({ size: 'lg' });
  });
});

// ---------------------------------------------------------------------------
// (f) vars or propsSchema missing → no error, other tiers apply
// ---------------------------------------------------------------------------

describe('resolveProps — (f) vars or propsSchema missing → no error', () => {
  it('vars missing (undefined) — data and schema still work', () => {
    const result = resolveProps({
      data: { title: 'hello' },
      propsSchema: { label: { default: 'world' } },
    });
    expect(result).toEqual({ title: 'hello', label: 'world' });
  });

  it('propsSchema missing (undefined) — data and vars still work', () => {
    const result = resolveProps({
      data: { title: 'hello' },
      vars: { accent: 'red' },
    });
    expect(result).toEqual({ title: 'hello', accent: 'red' });
  });

  it('data missing (undefined) — vars and schema still work', () => {
    const result = resolveProps({
      vars: { count: 3 },
      propsSchema: { label: { default: 'hi' } },
    });
    expect(result).toEqual({ count: 3, label: 'hi' });
  });

  it('non-plain-object vars (array) — no error, treated as empty', () => {
    const result = resolveProps({
      vars: ['not', 'an', 'object'],
      propsSchema: { label: { default: 'ok' } },
    });
    expect(result).toEqual({ label: 'ok' });
  });

  it('non-plain-object propsSchema (string) — no error, treated as empty', () => {
    const result = resolveProps({
      vars: { x: 1 },
      propsSchema: 'not-an-object',
    });
    expect(result).toEqual({ x: 1 });
  });

  it('vars is null — no error', () => {
    const result = resolveProps({
      data: { a: 1 },
      vars: null,
    });
    expect(result).toEqual({ a: 1 });
  });

  it('propsSchema is null — no error', () => {
    const result = resolveProps({
      data: { a: 1 },
      propsSchema: null,
    });
    expect(result).toEqual({ a: 1 });
  });
});
