// bundle-embed.js — ship the studio's MCP App build inside @lerret/cli.
//
// Copies packages/studio/dist-embed/embed.html → dist-embed/lerret-app.html
// (the `ui://` resource `@lerret/cli mcp` serves) and writes dist-embed/guide.md,
// the authoring guide the `lerret_guide` tool returns. The guide is rendered
// from create-lerret's ai-content.js — the single source the plugin skill and
// scaffolded AI files use — so it is never a second copy.

import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderClaudeSkill } from '../../create-lerret/src/ai-content.js';

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(cliDir, 'dist-embed');

await mkdir(dest, { recursive: true });
await copyFile(resolve(cliDir, '../studio/dist-embed/embed.html'), join(dest, 'lerret-app.html'));
// Drop the skill's YAML frontmatter; keep the body.
await writeFile(join(dest, 'guide.md'), renderClaudeSkill().replace(/^---[\s\S]*?---\s*/, ''));
process.stdout.write(`bundle-embed: wrote ${dest}\n`);
