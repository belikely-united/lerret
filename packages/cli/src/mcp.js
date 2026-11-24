// mcp.js — `@lerret/cli mcp`: Lerret as an MCP App for Claude and ChatGPT
// (plan-mcp-app-studio.md, Phase 1).
//
// One MCP server over the user's real `.lerret/` folder:
//   - the chat's model authors with plain file tools (list/read/write/delete)
//     and checks its work with `lerret_render` (a compact JPEG back);
//   - `lerret_open` shows the studio INSIDE the chat — an MCP Apps `ui://`
//     resource (the single-file `dist-embed/lerret-app.html` build);
//   - the studio reads files through app-only tools (`lerret_files`, paged
//     under the host's ~150K-char tool-result cap) and polls `lerret_version`
//     to pick up the model's edits live.
//
// Transports: stdio (Claude Desktop, Claude Code) by default; `--http <port>`
// serves Streamable HTTP at /mcp for hosts and testers that connect by URL.
// Nothing here writes to stdout except the stdio transport itself.

import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { resolveProject } from './resolve-project.js';
import { createNodeBackend, deleteEntry, fileInfo } from './fs/node-backend.js';

const fs = createNodeBackend();
const readText = (p) => fs.readFile(p);
const readBytes = async (p) => Buffer.from(await fs.readFile(p, { encoding: 'binary' }));

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(here, '..');
const APP_HTML = join(cliDir, 'dist-embed', 'lerret-app.html');
const GUIDE_MD = join(cliDir, 'dist-embed', 'guide.md');
const LERRET_BIN = join(here, 'lerret.js');

/** MCP Apps content type for an app's HTML resource. */
export const APP_MIME = 'text/html;profile=mcp-app';
/** Stay well under Claude's ~150K-char tool-result cap. */
export const PAGE_CHARS = 110_000;
/** Biggest single file the app will load. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Biggest text a model-facing read returns. */
const MAX_READ_CHARS = 100_000;

const TEXT_EXT = /\.(jsx|tsx|js|mjs|ts|json|md|mmd|mermaid|css|txt|svg|gltf|obj|html)$/i;

/** The CLI's own version — part of the ui:// URI so hosts that cache resources refetch on upgrade. */
async function cliVersion() {
  try {
    return JSON.parse(await readText(join(cliDir, 'package.json'))).version;
  } catch {
    return 'dev';
  }
}

// ── Paths ────────────────────────────────────────────────────────────────────

/**
 * A project-relative path the tools accept: `.lerret/social/og.jsx` or just
 * `social/og.jsx` (taken as inside `.lerret/`). Never outside `.lerret/`.
 *
 * @param {string} projectRoot  Absolute project folder (the parent of `.lerret/`).
 * @param {string} p
 * @returns {{ abs: string, rel: string }}
 */
export function safePath(projectRoot, p) {
  const clean = String(p || '').replaceAll('\\', '/').replace(/^\/+/, '');
  const inside = clean === '.lerret' || clean.startsWith('.lerret/') ? clean : `.lerret/${clean}`;
  const lerretDir = resolve(projectRoot, '.lerret');
  const abs = resolve(projectRoot, inside);
  if (abs !== lerretDir && !abs.startsWith(lerretDir + sep)) {
    throw new Error(`"${p}" is outside the project's .lerret/ folder.`);
  }
  return { abs, rel: relative(projectRoot, abs).split(sep).join('/') };
}

/** Every file under `.lerret/` (and a root `assets/`), skipping dot-folders and node_modules. */
export async function walkProject(projectRoot) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readDir(dir);
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory) await walk(abs);
      else {
        // A symlink to a folder (or a broken one) shows up as a file: skip it rather than read it.
        // ponytail: linked folders aren't followed — they can point at GBs outside the project.
        const info = await fileInfo(abs).catch(() => null);
        if (!info?.isFile) continue;
        out.push({ abs, rel: relative(projectRoot, abs).split(sep).join('/'), ...info });
      }
    }
  }
  await walk(join(projectRoot, '.lerret'));
  await walk(join(projectRoot, 'assets'));
  return out;
}

/** A cheap signature of the project's files: changes when anything is added, removed or saved. */
export async function projectVersion(projectRoot) {
  const h = createHash('sha1');
  for (const f of await walkProject(projectRoot)) h.update(`${f.rel}\0${f.size}\0${f.mtimeMs}\n`);
  return h.digest('hex').slice(0, 16);
}

/**
 * The project's files as pieces that fit the cap: a text file is one piece; a
 * binary is base64, split across pieces when large. Page `cursor` returns the
 * pieces from that index while they fit in PAGE_CHARS.
 */
export async function filesPage(projectRoot, cursor = 0) {
  const pieces = [];
  const skipped = [];
  for (const f of await walkProject(projectRoot)) {
    if (f.size > MAX_FILE_BYTES) {
      skipped.push(f.rel);
      continue;
    }
    // Big files go in slices (text by characters, binaries as base64); the app joins them.
    // ponytail: JSON escaping can grow a text slice ~20%; the slice is sized so that still fits the cap.
    const text = TEXT_EXT.test(f.rel);
    const len = text ? f.size : Math.ceil(f.size / 3) * 4;
    const step = text ? 80_000 : PAGE_CHARS - 1000;
    for (let i = 0; i === 0 || i < len; i += step) pieces.push({ path: f.rel, abs: f.abs, text, from: i, to: Math.min(i + step, len) });
  }
  const files = [];
  let used = 0;
  let i = cursor;
  const cache = new Map();
  for (; i < pieces.length; i++) {
    const p = pieces[i];
    if (!cache.has(p.abs)) {
      const buf = await readBytes(p.abs);
      cache.set(p.abs, p.text ? buf.toString('utf8') : buf.toString('base64'));
    }
    const body = cache.get(p.abs).slice(p.from, p.text && p.to >= p.size ? undefined : p.to);
    const entry = p.text ? { path: p.path, text: body } : { path: p.path, base64: body };
    const size = (entry.text ?? entry.base64).length + p.path.length + 40;
    if (files.length > 0 && used + size > PAGE_CHARS) break;
    files.push(entry);
    used += size;
  }
  return { files, next: i < pieces.length ? i : null, skipped };
}

// ── Render (headless export in a child process; stdout stays clean) ─────────

/**
 * Render a page or group folder with `@lerret/cli export` and return the images
 * as compact JPEGs (about 100K chars total, so the model can see them).
 */
async function renderFolder(projectRoot, folderRel, maxImages = 4) {
  const out = join(tmpdir(), `lerret-mcp-${randomUUID()}`);
  await fs.mkdir(out);
  try {
    const { abs } = safePath(projectRoot, folderRel);
    await new Promise((res, rej) => {
      execFile(process.execPath, [LERRET_BIN, 'export', abs, '--out', out, '--format', 'jpg', '--flat'], { cwd: projectRoot, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, _so, se) =>
        err ? rej(new Error(String(se || err.message).trim().split('\n').slice(-3).join('\n'))) : res(),
      );
    });
    const names = (await fs.readDir(out)).map((e) => e.name).filter((n) => /\.jpe?g$/i.test(n)).sort();
    const images = [];
    let budget = 120_000;
    for (const name of names.slice(0, maxImages)) {
      const b64 = (await readBytes(join(out, name))).toString('base64');
      if (b64.length > budget) break;
      budget -= b64.length;
      images.push({ name, data: b64 });
    }
    return { images, total: names.length };
  } finally {
    await deleteEntry(out);
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

const text = (t) => ({ type: 'text', text: t });

/**
 * Build the MCP server for one project folder.
 *
 * @param {string | null} projectRoot  Absolute folder containing `.lerret/`, or null to wait for a `folder` argument.
 * @param {{ version?: string }} [opts]
 */
export async function createLerretMcpServer(projectRoot, opts = {}) {
  const version = opts.version || (await cliVersion());
  const appUri = `ui://lerret/studio-${version}.html`;
  const nameOf = (root) => root.split(/[\\/]/).filter(Boolean).pop() || 'project';

  // Which project a call works on: its own `folder`, else the last one opened,
  // else the server's --folder. The studio in a chat passes the folder its
  // lerret_open returned, so it never follows a later open in another chat.
  // ponytail: one shared default per server process (Claude Desktop shares it
  // across chats); the model passes `folder` again when it switches projects.
  let current = projectRoot;
  const roots = new Map();
  async function rootFor(folder) {
    if (!folder) {
      if (current) return current;
      throw new Error('No Lerret project chosen yet. Call lerret_open with `folder` set to the project\'s absolute path.');
    }
    if (!roots.has(folder)) {
      const found = await resolveProject(resolve(folder));
      if (!found.found) throw new Error(`No .lerret/ folder found in ${folder} or above it. Run \`npx create-lerret\` there first.`);
      roots.set(folder, found.projectRoot);
    }
    return roots.get(folder);
  }
  const folderArg = z
    .string()
    .optional()
    .describe('Absolute path of the Lerret project (the folder with .lerret/, or any folder inside it). Defaults to the project last opened.');

  const server = new McpServer(
    { name: 'lerret', title: 'Lerret', version },
    {
      instructions:
        'Lerret is a design canvas: every .jsx file under .lerret/ is a visual asset (React), .mmd files are Mermaid diagrams, .md files are notes, .glb/.stl files are 3D models. ' +
        'Before authoring, call lerret_guide once for the conventions and aesthetic bar. Author with lerret_write, verify with lerret_render, ' +
        'and call lerret_open to show the live studio to the user in the chat — it updates as you write. ' +
        'When you are working in a project folder (a coding session), pass its absolute path as `folder` to lerret_open. ' +
        'Whenever the user asks to open, show or preview the studio, call lerret_open — also in Claude Code — instead of starting ' +
        '`@lerret/cli dev`, a browser or a preview-pane server, even if a launch config for one already exists.',
    },
  );

  const ui = (visibility) => ({ ui: { resourceUri: appUri, ...(visibility ? { visibility } : {}) }, 'ui/resourceUri': appUri });

  server.registerTool(
    'lerret_open',
    {
      title: 'Open the Lerret studio',
      description:
        'Show the live Lerret studio (the design canvas) inside the chat. The user can browse pages, open the full studio, edit props and export. It updates live as files change. ' +
        'Use this, not a browser or `@lerret/cli dev` server, whenever the user wants to see the studio. ' +
        'Pass `folder` (absolute path) when you are working in a project folder, e.g. a coding session: the studio then shows that project, and later calls use it too. ' +
        'Optional `page`: a page folder to mention.',
      inputSchema: z.object({ folder: folderArg, page: z.string().optional() }),
      annotations: { readOnlyHint: true },
      // Global entry point: Claude (remote connectors) and ChatGPT can list the app on their own.
      _meta: { ...ui(), 'openai/ui': { entrypoints: [{ type: 'global' }] } },
    },
    async ({ folder, page }) => {
      const root = await rootFor(folder);
      current = root;
      const name = nameOf(root);
      const files = await walkProject(root);
      const pages = [...new Set(files.map((f) => f.rel.split('/')[1]).filter((p) => p && !p.includes('.') && !p.startsWith('_')))];
      return {
        content: [text(`Opened the Lerret studio for "${name}" at ${root} (${files.length} files; pages: ${pages.join(', ') || 'none yet'}).${page ? ` Look at the "${page}" page.` : ''}`)],
        structuredContent: { name, pages, folder: root },
      };
    },
  );

  server.registerTool(
    'lerret_guide',
    {
      title: 'Lerret authoring guide',
      description: 'The conventions for Lerret assets (meta export, props, variants, data files, config, fonts, diagrams, 3D) and the aesthetic bar. Read once before authoring.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return { content: [text(await readText(GUIDE_MD))] };
      } catch {
        return { content: [text('Guide not bundled in this build. Assets are default-exported React components in .lerret/<page>/<Name>.jsx with an optional `export const meta = { dimensions: { width, height } }`.')] };
      }
    },
  );

  server.registerTool(
    'lerret_list',
    {
      title: 'List project files',
      description: 'List every file in the project (.lerret/ and a root assets/ folder) with sizes.',
      inputSchema: z.object({ folder: folderArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ folder }) => {
      const root = await rootFor(folder);
      const files = await walkProject(root);
      return { content: [text(files.map((f) => `${f.rel}  (${f.size} B)`).join('\n') || 'The project is empty.')] };
    },
  );

  server.registerTool(
    'lerret_read',
    {
      title: 'Read a project file',
      description: 'Read a text file from the project, e.g. ".lerret/social/og-card.jsx".',
      inputSchema: z.object({ path: z.string(), folder: folderArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ path, folder }) => {
      const root = await rootFor(folder);
      const { abs, rel } = safePath(root, path);
      const body = await readText(abs);
      return { content: [text(body.length > MAX_READ_CHARS ? `${body.slice(0, MAX_READ_CHARS)}\n… (truncated; ${rel} is ${body.length} chars)` : body)] };
    },
  );

  server.registerTool(
    'lerret_write',
    {
      title: 'Write a project file',
      description:
        'Create or replace a file in the project (.lerret/…): a .jsx asset, its .data.json, a .mmd diagram, config.json, a .md note. Folders are created as needed. The open studio updates live.',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        encoding: z.enum(['utf8', 'base64']).optional(),
        append: z.boolean().optional(),
        folder: folderArg,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ path, content, encoding = 'utf8', append = false, folder }) => {
      const root = await rootFor(folder);
      const { abs, rel } = safePath(root, path);
      await fs.mkdir(dirname(abs));
      let data = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
      // ponytail: append = read + rewrite (atomic writes); chunks are ≤90K so this is fine for project-sized files.
      if (append && (await fs.exists(abs))) data = Buffer.concat([await readBytes(abs), data]);
      await fs.writeFile(abs, new Uint8Array(data), { encoding: 'binary' });
      return { content: [text(`Wrote ${rel}.`)], structuredContent: { path: rel } };
    },
  );

  server.registerTool(
    'lerret_delete',
    {
      title: 'Delete a project file',
      description: 'Delete a file (or, with dir: true, an empty folder) in the project.',
      inputSchema: z.object({ path: z.string(), dir: z.boolean().optional(), folder: folderArg }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ path, dir, folder }) => {
      const root = await rootFor(folder);
      const { abs, rel } = safePath(root, path);
      if (rel === '.lerret') throw new Error('Refusing to delete the .lerret/ folder itself.');
      if (dir) await fs.removeDir(abs);
      else await fs.deleteFile(abs);
      return { content: [text(`Deleted ${rel}.`)] };
    },
  );

  server.registerTool(
    'lerret_render',
    {
      title: 'Render a page to images',
      description:
        'Render a page or group folder (e.g. ".lerret/social") headlessly and return the artboards as small JPEGs, so you can check how your design looks. Use after writing.',
      inputSchema: z.object({ path: z.string(), folder: folderArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ path, folder }) => {
      const root = await rootFor(folder);
      const { images, total } = await renderFolder(root, path);
      if (images.length === 0) return { content: [text(`Nothing rendered in ${path} (no artboards, or they failed — check lerret_list).`)] };
      return {
        content: [
          text(`Rendered ${total} artboard${total === 1 ? '' : 's'} in ${path}; showing ${images.length}.`),
          ...images.flatMap((im) => [text(im.name), { type: 'image', data: im.data, mimeType: 'image/jpeg' }]),
        ],
      };
    },
  );

  // ── App-only tools (the studio in the chat calls these; the model never sees them)

  server.registerTool(
    'lerret_files',
    {
      title: 'Project files (app)',
      description: 'Paged project contents for the Lerret studio app.',
      inputSchema: z.object({ cursor: z.number().int().min(0).optional(), folder: folderArg }),
      annotations: { readOnlyHint: true },
      _meta: ui(['app']),
    },
    async ({ cursor = 0, folder }) => {
      const root = await rootFor(folder);
      const page = await filesPage(root, cursor);
      const v = cursor === 0 ? await projectVersion(root) : undefined;
      return { content: [text(`${page.files.length} files`)], structuredContent: { ...page, version: v, name: nameOf(root) } };
    },
  );

  server.registerTool(
    'lerret_version',
    {
      title: 'Project version (app)',
      description: 'Change signature of the project files, polled by the Lerret studio app.',
      inputSchema: z.object({ folder: folderArg }),
      annotations: { readOnlyHint: true },
      _meta: ui(['app']),
    },
    async ({ folder }) => {
      const root = await rootFor(folder);
      const version = await projectVersion(root);
      return { content: [text(version)], structuredContent: { version } };
    },
  );

  server.registerTool(
    'lerret_mkdir',
    {
      title: 'Create a folder (app)',
      description: 'Create a folder in the project, for the Lerret studio app.',
      inputSchema: z.object({ path: z.string(), folder: folderArg }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: ui(['app']),
    },
    async ({ path, folder }) => {
      const root = await rootFor(folder);
      const { abs, rel } = safePath(root, path);
      await fs.mkdir(abs);
      return { content: [text(`Created ${rel}.`)] };
    },
  );

  server.registerResource('Lerret studio', appUri, { mimeType: APP_MIME, title: 'Lerret studio' }, async () => {
    const html = await readText(APP_HTML);
    return { contents: [{ uri: appUri, mimeType: APP_MIME, text: html, _meta: { ui: { prefersBorder: true, preferredDisplayMode: 'fullscreen' } } }] };
  });

  return server;
}

// ── Command ──────────────────────────────────────────────────────────────────

function printUsage() {
  process.stderr.write(
    [
      '@lerret/cli mcp — Lerret as an MCP App: the studio inside Claude or ChatGPT.',
      '',
      'Usage: @lerret/cli mcp [options]',
      '',
      'Options:',
      '  --folder <dir>   Default project (default: nearest .lerret/ from the current folder;',
      '                   without one, the chat picks the project with lerret_open\'s `folder`).',
      '  --http <port>    Serve Streamable HTTP at http://localhost:<port>/mcp instead of stdio.',
      '  -h, --help       Show this help.',
      '',
      'Claude Desktop (claude_desktop_config.json):',
      '  { "mcpServers": { "lerret": { "command": "npx",',
      '      "args": ["-y", "@lerret/cli@latest", "mcp", "--folder", "/path/to/project"] } } }',
      '',
    ].join('\n'),
  );
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runMcp(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { folder: { type: 'string' }, http: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: false,
    }));
  } catch (err) {
    process.stderr.write(`@lerret/cli mcp: ${err.message}\n\n`);
    printUsage();
    return 1;
  }
  if (values.help) {
    printUsage();
    return 0;
  }

  const found = await resolveProject(values.folder ? resolve(values.folder) : process.cwd());
  if (!found.found && values.folder) {
    process.stderr.write(`@lerret/cli mcp: no .lerret/ folder found from ${found.startDir}.\n`);
    return 1;
  }
  // Without --folder and outside a project, the model picks one with lerret_open's `folder`.
  const projectRoot = found.found ? found.projectRoot : null;
  // stdout carries the protocol; route stray logs to stderr.
  console.log = console.info = (...a) => process.stderr.write(a.join(' ') + '\n');

  if (values.http) {
    const port = Number(values.http);
    const { NodeStreamableHTTPServerTransport } = await import('@modelcontextprotocol/node');
    const httpServer = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.end();
      if (!req.url.startsWith('/mcp')) {
        res.statusCode = 404;
        return res.end();
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const server = await createLerretMcpServer(projectRoot);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      } catch (err) {
        process.stderr.write(`@lerret/cli mcp: ${err.stack || err}\n`);
        if (!res.headersSent) res.writeHead(500).end();
      }
    });
    // ponytail: localhost only — this server can write the project folder.
    await new Promise((r) => httpServer.listen(port, '127.0.0.1', r));
    process.stderr.write(`@lerret/cli mcp: ${projectRoot ?? '(no default project)'}\n@lerret/cli mcp: listening on http://localhost:${port}/mcp\n`);
    return new Promise(() => {}); // until killed
  }

  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const server = await createLerretMcpServer(projectRoot);
  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write(`@lerret/cli mcp: serving ${projectRoot ?? '(no default project)'} over stdio\n`);
  return new Promise(() => {}); // until the client closes stdin
}
