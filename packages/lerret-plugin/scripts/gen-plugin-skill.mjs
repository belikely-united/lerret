// Generates the plugin's `author` skill from the SINGLE authoring source —
// create-lerret's `ai-content.js` (`renderPluginSkill()`). The author skill is
// build output: never hand-edit `skills/author/SKILL.md`. Regenerate with:
//
//   pnpm --filter @lerret/plugin build
//
// A drift test in create-lerret (`src/plugin-skill.test.js`) fails CI if the
// committed file ever diverges from this render.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPluginSkill } from '../../create-lerret/src/ai-content.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../skills/author/SKILL.md');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderPluginSkill());

process.stdout.write(`wrote ${out}\n`);
