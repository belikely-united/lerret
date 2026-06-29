// Drift guard: the Lerret plugin's single root skill (`SKILL.md` at the plugin
// root) is build output, generated from this package's `renderPluginSkill()`. If
// the committed file ever diverges from the render, the generator wasn't re-run
// — fail loudly.
//
// Regenerate with: pnpm --filter @lerret/plugin build

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { renderPluginSkill } from './ai-content.js';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT_SKILL = resolve(here, '../../lerret-plugin/SKILL.md');

describe('lerret plugin root skill', () => {
  it('matches renderPluginSkill() exactly (no drift — regenerate if this fails)', () => {
    const committed = readFileSync(PLUGIN_ROOT_SKILL, 'utf8');
    expect(committed).toBe(renderPluginSkill());
  });

  it('is a single-skill plugin: frontmatter name is `lerret` (→ bare /lerret)', () => {
    expect(renderPluginSkill()).toMatch(/^---\nname: lerret\n/);
  });
});
