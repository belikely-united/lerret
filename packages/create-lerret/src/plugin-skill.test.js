// Drift guard: the Lerret plugin's `author` skill is build output, generated
// from this package's `renderPluginSkill()`. If the committed file ever
// diverges from the render, the generator wasn't re-run — fail loudly.
//
// Regenerate with: pnpm --filter @lerret/plugin build

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { renderPluginSkill } from './ai-content.js';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_AUTHOR_SKILL = resolve(
  here,
  '../../lerret-plugin/skills/author/SKILL.md',
);

describe('lerret plugin author skill', () => {
  it('matches renderPluginSkill() exactly (no drift — regenerate if this fails)', () => {
    const committed = readFileSync(PLUGIN_AUTHOR_SKILL, 'utf8');
    expect(committed).toBe(renderPluginSkill());
  });

  it('is generated, not hand-written: frontmatter name is `author`', () => {
    expect(renderPluginSkill()).toMatch(/^---\nname: author\n/);
  });
});
