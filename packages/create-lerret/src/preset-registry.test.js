// Tests for the themed preset registry (Story 7.3).
//
// The registry lives at `packages/create-lerret/presets.json` and lists each
// themed preset's directory (relative to the package root). For each preset
// the test asserts:
//
//   • The expected seven preset names are present — no more, no fewer.
//   • The `dir` exists on disk relative to the package root.
//   • The preset's `.lerret/config.json` parses as JSON.
//   • The preset's `_meta.preset` value is `<name>-v1`.
//
// Pure filesystem + JSON checks — no studio loader, no runtime mounting.

import { promises as fsp } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';

// Anchor the test against the package root regardless of cwd.
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const REGISTRY_PATH = join(PACKAGE_ROOT, 'presets.json');

const EXPECTED_PRESETS = [
  'acme',
  'appstore',
  'producthunt',
  'social-media',
  'talks',
  'personal',
  'live',
];

/** @type {{ presets: Record<string, { dir: string; label: string; description: string }> }} */
let registry;

beforeAll(async () => {
  const raw = await fsp.readFile(REGISTRY_PATH, 'utf8');
  registry = JSON.parse(raw);
});

describe('preset registry (presets.json)', () => {
  it('exists at packages/create-lerret/presets.json', async () => {
    const stat = await fsp.stat(REGISTRY_PATH);
    expect(stat.isFile()).toBe(true);
  });

  it('exposes a `presets` object', () => {
    expect(registry).toBeTypeOf('object');
    expect(registry).not.toBeNull();
    expect(registry.presets).toBeTypeOf('object');
    expect(registry.presets).not.toBeNull();
  });

  it('lists exactly the seven expected preset names and no others', () => {
    const names = Object.keys(registry.presets).sort();
    const expected = [...EXPECTED_PRESETS].sort();
    expect(names).toEqual(expected);
  });

  it('each entry has `dir`, `label`, and `description` string fields', () => {
    for (const name of EXPECTED_PRESETS) {
      const entry = registry.presets[name];
      expect(entry, `entry for "${name}"`).toBeTypeOf('object');
      expect(typeof entry.dir, `presets["${name}"].dir`).toBe('string');
      expect(typeof entry.label, `presets["${name}"].label`).toBe('string');
      expect(typeof entry.description, `presets["${name}"].description`).toBe('string');
      expect(entry.dir.length, `presets["${name}"].dir length`).toBeGreaterThan(0);
      expect(entry.label.length, `presets["${name}"].label length`).toBeGreaterThan(0);
      expect(entry.description.length, `presets["${name}"].description length`).toBeGreaterThan(0);
    }
  });

  it.each(EXPECTED_PRESETS)('preset "%s" has an existing directory on disk', async (name) => {
    const entry = registry.presets[name];
    const absDir = join(PACKAGE_ROOT, entry.dir);
    const stat = await fsp.stat(absDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it.each(EXPECTED_PRESETS)('preset "%s" ships a parseable .lerret/config.json', async (name) => {
    const entry = registry.presets[name];
    const configPath = join(PACKAGE_ROOT, entry.dir, '.lerret', 'config.json');
    const raw = await fsp.readFile(configPath, 'utf8');
    // Throws if invalid JSON — Vitest surfaces the message verbatim.
    const parsed = JSON.parse(raw);
    expect(parsed).toBeTypeOf('object');
    expect(parsed).not.toBeNull();
  });

  it.each(EXPECTED_PRESETS)('preset "%s" carries `_meta.preset === "%s-v1"`', async (name) => {
    const entry = registry.presets[name];
    const configPath = join(PACKAGE_ROOT, entry.dir, '.lerret', 'config.json');
    const raw = await fsp.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed._meta, `_meta on "${name}"`).toBeTypeOf('object');
    expect(parsed._meta).not.toBeNull();
    expect(parsed._meta.preset).toBe(`${name}-v1`);
  });
});
