// Memory agent — reads the user's brand/context/memory files and injects the
// assembled, SCOPE-ANCHORED context into downstream node prompts (FR53). Also
// indexes the `_brand/` asset folder (filename + type ONLY — no image bytes in
// v1; the vision path is Story 8.7).
//
// ── Two surfaces, one read core ──────────────────────────────────────────────
//
// `createMemoryNode({ sandbox, emit })` — the Story 8.3 LangGraph node. Returns
//   `{ context }`. Its return contract is UNCHANGED by Story 8.6; it now
//   DELEGATES the scope split to `../../memory/scope.js` so the assembled
//   context is genuinely scope-anchored instead of a flat concatenation.
//
// `createMemoryAgent({ projectRoot, fs })` — the richer Story 8.6 surface the
//   orchestrator (once 8.3 adopts it) calls: `readMemory()` /
//   `indexBrandFolder()` / `assembleContext()` / `readBrandAsset()`. It takes
//   the UNWRAPPED `fs` (reads only — never a sandbox/write surface) and threads
//   `projectRoot` so every read is an ABSOLUTE path (the v1 FilesystemAccess
//   backends speak absolute paths; a relative path returns ENOENT at runtime).
//
// READ-ONLY invariant: this agent NEVER writes. It has no sandbox. The Worker
// (Story 8.3) is the only mutator. The no-direct-fs guard
// (./worker-no-direct-fs.test.js) is satisfied: no `node:*` import, no
// `fs.writeFile`/`fs.mkdir`/`fs.unlink` — only `fs.readFile` / `fs.readDir`.

import { reading } from '../events.js';
import {
  DESIGN_SYSTEM_PATH,
  CONTEXT_PATH,
  MEMORY_PATH,
  BRAND_DIR,
  RESERVED_MEMORY_PATHS,
} from '../../memory/paths.js';
import { resolveScopedContext } from '../../memory/scope.js';

// Re-export the reserved-path set under the historical name so the Story 8.3
// node tests + any importer that read `RESERVED_CONTEXT_PATHS` from here keep
// working. `paths.js` is now the single source of truth for the string values.
export { BRAND_DIR } from '../../memory/paths.js';

/**
 * The three reserved Markdown context paths, in injection order. Historical
 * alias of `RESERVED_MEMORY_PATHS` (paths.js) — kept so existing imports of
 * `RESERVED_CONTEXT_PATHS` from this module are unbroken.
 *
 * @type {readonly string[]}
 */
export const RESERVED_CONTEXT_PATHS = RESERVED_MEMORY_PATHS;

/**
 * The set of extensions treated as raster images — indexed by name only, NEVER
 * byte-read in v1 (AC-5 / guardrail #5).
 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

/**
 * Derive a brand-asset `type` from a filename extension. SVGs are `'logo'` when
 * the stem reads like a logo, else `'vector'`; raster images are `'image'`;
 * everything else is `'asset'`.
 *
 * @param {string} name
 * @returns {'logo' | 'vector' | 'image' | 'asset'}
 */
export function brandAssetType(name) {
  const lower = String(name ?? '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (ext === '.svg') {
    // A logo SVG reads like a logo/mark by NAME. A swatch (even
    // `swatch-brand.svg`) is a vector, not a logo — so `brand` alone does
    // NOT qualify; only an explicit logo/logotype/logomark stem does.
    const stem = dot >= 0 ? lower.slice(0, dot) : lower;
    return /(?:^|[-_])logo(?:type|mark)?(?:$|[-_.])|(?:^|[-_])wordmark(?:$|[-_.])/.test(
      stem,
    )
      ? 'logo'
      : 'vector';
  }
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'asset';
}

/**
 * Derive the folder-scope string the scope parser anchors on from the turn's
 * `scope` value. Accepts the REAL shapes `runTurn` receives:
 *   - a plain folder-scope string (`'social-media/'`) → returned as-is;
 *   - the dock's selection-scope object with a string `filePath`
 *     (`{ kind: 'file', filePath: 'social-media/twitter/card.jsx' }`) → the
 *     file's parent folder + `'/'` (`'social-media/twitter/'`); a bare
 *     filename with no folder → `''`;
 *   - `{ kind: 'page', label }` with a string label → `label + '/'`;
 *   - anything else (`{ type: 'project' }`, artboard-count selections, null,
 *     undefined) → `''` (global-only anchoring — never an error).
 *
 * @param {unknown} scope
 * @returns {string}
 */
export function deriveTargetScope(scope) {
  if (typeof scope === 'string') return scope;
  if (scope && typeof scope === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (scope);
    if (typeof obj.filePath === 'string') {
      const slash = obj.filePath.lastIndexOf('/');
      return slash === -1 ? '' : obj.filePath.slice(0, slash + 1);
    }
    if (obj.kind === 'page' && typeof obj.label === 'string') {
      return `${obj.label}/`;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Story 8.6 agent surface — createMemoryAgent({ projectRoot, fs })
// ---------------------------------------------------------------------------

/**
 * The minimal read-only FilesystemAccess shape the Memory agent needs.
 * Documented inline (not imported) so this file stays import-light, mirroring
 * `worker.js`'s `@typedef Sandbox`.
 *
 * @typedef {{
 *   readFile: (path: string, options?: object) => Promise<string | Uint8Array>,
 *   readDir: (path: string) => Promise<Array<{ name: string, path?: string, isFile?: boolean, isDirectory?: boolean, kind?: string }>>,
 * }} ReadFs
 */

/**
 * Join `projectRoot` + a project-relative path into an absolute POSIX path.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {string}
 */
function absoluteOf(projectRoot, relPath) {
  const root = String(projectRoot ?? '').replace(/\/+$/, '');
  return `${root}/${relPath}`;
}

/**
 * Read a single reserved Markdown file via the unwrapped `fs`. Graceful
 * absence: a missing / unreadable file returns `''`, never throws.
 *
 * @param {ReadFs} fs
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {Promise<string>}
 */
async function readMarkdown(fs, projectRoot, relPath) {
  try {
    const raw = await fs.readFile(absoluteOf(projectRoot, relPath), {
      encoding: 'utf-8',
    });
    return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  } catch {
    return '';
  }
}

/**
 * Create the Story 8.6 Memory agent.
 *
 * @param {{ projectRoot: string, fs: ReadFs }} deps
 * @returns {{
 *   readMemory: () => Promise<{ designSystem: string, context: string, memory: string }>,
 *   indexBrandFolder: () => Promise<Array<{ name: string, type: string, path: string }>>,
 *   readBrandAsset: (name: string) => Promise<string>,
 *   assembleContext: (args: { memory: { designSystem: string, context: string, memory: string }, targetScope?: string }) => { promptFragment: string, filesRead: string[] },
 * }}
 */
export function createMemoryAgent({ projectRoot, fs }) {
  // Mirrors createMockSandbox's validation: the v1 FilesystemAccess backends
  // speak ABSOLUTE paths, so a relative projectRoot would ENOENT every read.
  if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/')) {
    throw new TypeError(
      'createMemoryAgent: projectRoot must be an absolute path (a string starting with "/")',
    );
  }
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.readDir !== 'function') {
    throw new TypeError('createMemoryAgent: fs must expose readFile + readDir');
  }

  /** Read the three reserved Markdown files (graceful absence → ''). */
  async function readMemory() {
    const [designSystem, context, memory] = await Promise.all([
      readMarkdown(fs, projectRoot, DESIGN_SYSTEM_PATH),
      readMarkdown(fs, projectRoot, CONTEXT_PATH),
      readMarkdown(fs, projectRoot, MEMORY_PATH),
    ]);
    return { designSystem, context, memory };
  }

  /**
   * Index `.lerret/_brand/`: filename + derived type ONLY. A missing dir
   * returns `[]`. NEVER reads image bytes (guardrail #5).
   */
  async function indexBrandFolder() {
    let entries;
    try {
      entries = await fs.readDir(absoluteOf(projectRoot, BRAND_DIR));
    } catch {
      return [];
    }
    if (!Array.isArray(entries)) return [];
    const out = [];
    for (const e of entries) {
      // Skip directories; everything else is treated as an indexable file.
      if (e?.isDirectory === true || e?.kind === 'directory') continue;
      const name = String(e?.name ?? '');
      if (name.length === 0) continue;
      out.push({
        name,
        type: brandAssetType(name),
        // ALWAYS the project-relative path — never the backend-absolute
        // `e.path` — so the index matches the WorkerStep relative-path
        // convention regardless of which FilesystemAccess backend listed it.
        path: `${BRAND_DIR}/${name}`,
      });
    }
    return out;
  }

  /**
   * Read the text content of a single brand asset (used by the Worker-copy
   * plan — e.g. an SVG logo). This is a TEXT read for vector assets; raster
   * image bytes are NOT read here (that is Story 8.7's vision surface).
   *
   * `name` must be a SINGLE plain path segment — a separator (`/` or `\`),
   * a dot-segment (`.` / `..`), or an empty name would escape `_brand/` and
   * is rejected (returns `''`, never reads).
   *
   * @param {string} name  The brand-asset filename (e.g. `logo.svg`).
   * @returns {Promise<string>}
   */
  async function readBrandAsset(name) {
    const seg = typeof name === 'string' ? name : '';
    if (
      seg.length === 0 ||
      seg === '.' ||
      seg === '..' ||
      seg.includes('/') ||
      seg.includes('\\')
    ) {
      return '';
    }
    const rel = `${BRAND_DIR}/${seg}`;
    try {
      const raw = await fs.readFile(absoluteOf(projectRoot, rel), { encoding: 'utf-8' });
      return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    } catch {
      return '';
    }
  }

  /**
   * Compose the final brand-context fragment for the active turn's target
   * scope (closer-scope rules win — delegated to scope.js). `filesRead` lists
   * the reserved paths that contributed non-empty content (feeds the dock
   * thread's "Read N files" outcome line, Story 8.2).
   *
   * @param {{ memory: { designSystem: string, context: string, memory: string }, targetScope?: string }} args
   * @returns {{ promptFragment: string, filesRead: string[] }}
   */
  function assembleContext({ memory, targetScope } = {}) {
    const bodies = memory ?? { designSystem: '', context: '', memory: '' };
    const promptFragment = resolveScopedContext(bodies, targetScope);
    const filesRead = [];
    if (bodies.designSystem?.trim()) filesRead.push(DESIGN_SYSTEM_PATH);
    if (bodies.context?.trim()) filesRead.push(CONTEXT_PATH);
    if (bodies.memory?.trim()) filesRead.push(MEMORY_PATH);
    return { promptFragment, filesRead };
  }

  return { readMemory, indexBrandFolder, readBrandAsset, assembleContext };
}

// ---------------------------------------------------------------------------
// Story 8.3 graph node — createMemoryNode({ sandbox, emit })
// ---------------------------------------------------------------------------

/**
 * Create the Memory graph node. Reads each reserved path that exists (graceful
 * absence — a missing file contributes an empty section, never an error) and
 * returns the assembled context string in the `context` state slot.
 *
 * Story 8.6 rewires the BODY to delegate the scope split to `scope.js` so the
 * node is genuinely scope-anchored: it reads the raw bodies, then composes via
 * `resolveScopedContext` for the turn's `state.scope` (closer-scope wins),
 * falling back to a headered concatenation only for files with no scope
 * comments. The `{ context }` RETURN CONTRACT and the `reading`-per-file emit
 * behavior are UNCHANGED — the existing node tests still pass.
 *
 * @param {{ sandbox: import('./types.js').Sandbox, emit: (ev: unknown) => void }} deps
 * @returns {(state: object) => Promise<{ context: string }>}
 */
export function createMemoryNode({ sandbox, emit }) {
  return async function memoryNode(state) {
    if (state?.signal?.aborted) return { context: '' };

    // Read each present reserved file via the sandbox (reads), emitting a
    // `reading` event per non-empty file — UNCHANGED behavior.
    /** @type {Record<string, string>} */
    const bodies = {};
    for (const path of RESERVED_CONTEXT_PATHS) {
      let present = false;
      try {
        present = await sandbox.exists(path);
      } catch {
        present = false;
      }
      if (!present) continue;
      try {
        const content = await sandbox.readFile(path, { encoding: 'utf-8' });
        const text =
          typeof content === 'string' ? content : new TextDecoder().decode(content);
        if (text.trim().length > 0) {
          emit(reading(path));
          bodies[path] = text;
        }
      } catch {
        // A read error on an existing file is non-fatal — skip it.
      }
    }

    const present = RESERVED_CONTEXT_PATHS.filter((p) => bodies[p] != null);
    if (present.length === 0) return { context: '' };

    // If ANY present file carries a scope comment, delegate to the scope
    // parser for closer-scope-wins anchoring against the turn's target
    // scope. Otherwise keep the historical headered concatenation so the
    // Story 8.3 assembly tests (which assert the `# path\n\nbody` framing)
    // remain green. The turn's `scope` is usually the dock's selection-scope
    // OBJECT (`{ kind, filePath?, count?, label? }`), not a string —
    // deriveTargetScope maps every real shape to the anchoring folder.
    const targetScope = deriveTargetScope(state?.scope);
    const anyScoped = present.some((p) => /<!--\s*scope:/.test(bodies[p]));
    if (anyScoped && targetScope) {
      const fragment = resolveScopedContext(
        {
          designSystem: bodies[DESIGN_SYSTEM_PATH] ?? '',
          context: bodies[CONTEXT_PATH] ?? '',
          memory: bodies[MEMORY_PATH] ?? '',
        },
        targetScope,
      );
      return { context: fragment };
    }

    const sections = present.map((p) => `# ${p}\n\n${bodies[p].trim()}`);
    return { context: sections.join('\n\n---\n\n') };
  };
}
