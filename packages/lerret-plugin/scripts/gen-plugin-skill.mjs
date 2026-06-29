// Generates the plugin's single root skill from the SINGLE authoring source —
// create-lerret's `ai-content.js` (`renderPluginSkill()`). The plugin ships as a
// single-skill plugin (a `SKILL.md` at the plugin root, no `skills/` subdir), so
// the bare `/lerret` command works. This file is build output: never hand-edit
// the root `SKILL.md`. Regenerate with:
//
//   pnpm --filter @lerret/plugin build
//
// A drift test in create-lerret (`src/plugin-skill.test.js`) fails CI if the
// committed file ever diverges from this render.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPluginSkill } from '../../create-lerret/src/ai-content.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../SKILL.md');

writeFileSync(out, renderPluginSkill());

process.stdout.write(`wrote ${out}\n`);
