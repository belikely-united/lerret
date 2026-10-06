// Selection-scoped file reading — SHARED by the Planner and the Inspector.
//
// The dock chip's `{kind:'file', filePath}` names the asset the user has
// selected on the canvas. Both provider-calling agents need its CURRENT
// content folded into their prompts:
//   - the Planner, so an edit rewrites the real file at its real path
//     (FR50's "follow-ups stay scoped" — Epic 8 close live-model finding);
//   - the Inspector, so questions about the selection are answered from the
//     real file and change-request redirects name the SELECTED asset, not a
//     guessed one (live user-testing finding, 2026-06-12 — a chip-scoped
//     "change color to blue" in Inspect mode pointed the user at
//     _design-system.md instead of their selection).
//
// Reads go through the sandbox's NON-mutating surface only (exists +
// readFile) — safe for the Inspector's structural read-only guarantee
// (inspect-no-worker.test.js scans this module too via its import edge).

/**
 * Max characters of a selection-scoped file folded into an agent prompt. The
 * prompt tells the model to rewrite the COMPLETE file, so this must comfortably
 * hold a real asset — a truncated selection is flagged (`truncated`) so the
 * model knows the tail is missing rather than silently dropping it.
 */
export const SCOPED_FILE_CHAR_CAP = 40000;

/** Max characters of the selection's companion data file folded into a prompt. */
export const SCOPED_DATA_CHAR_CAP = 8000;

/**
 * Normalize a selection-chip file path to the project-relative form the
 * workflow planners speak (`kit/banner.jsx` — no `.lerret/` prefix). The
 * chip's `filePath` is whatever identity the studio runtime uses: the CLI
 * dev-server runtime hands out ABSOLUTE paths
 * (`/tmp/proj/.lerret/kit/banner.jsx`), the hosted/fixture runtimes
 * project-relative ones — found live when "make 3 variants of this" planned
 * nothing because the absolute chip path failed W3's existence gate
 * (2026-06-12).
 *
 * @param {unknown} filePath
 * @returns {string | undefined}
 */
export function toProjectRelativeLerretPath(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) return undefined;
    const marker = '/.lerret/';
    const at = filePath.indexOf(marker);
    if (at !== -1) return filePath.slice(at + marker.length);
    return filePath.startsWith('.lerret/') ? filePath.slice('.lerret/'.length) : filePath;
}

/**
 * Canonicalize a MODEL-supplied tool path to the sandbox's `.lerret/<rel>`
 * form — the ONE normalization seam shared by the Agent Executor's and the
 * Inspector's tool executors (review finding L5: two copies drift). Real
 * models send project-relative, `.lerret/`-prefixed, and absolute shapes;
 * traversal does not need catching here — the sandbox's normalize+validate
 * is the authority and turns escapes into typed violations.
 *
 * @param {unknown} p
 * @returns {string | null}  `.lerret/` for the root; null for unusable input.
 */
export function canonLerretPath(p) {
    if (typeof p !== 'string' || p.trim().length === 0) return null;
    const trimmed = p.trim();
    if (trimmed === '.lerret' || trimmed === '.lerret/') return '.lerret/';
    const rel = toProjectRelativeLerretPath(trimmed);
    return rel ? `.lerret/${rel.replace(/^\/+/, '')}` : null;
}

/**
 * The companion data-file paths for an asset path — `card.jsx` →
 * `card.data.json` / `card.data.js`. Empty for a non-component path.
 *
 * @param {string} assetPath  A `.lerret/<rel>.jsx|.tsx` path.
 * @returns {string[]}
 */
export function dataFilePathsFor(assetPath) {
    const m = /^(.*)\.(jsx|tsx)$/.exec(String(assetPath ?? ''));
    return m ? [`${m[1]}.data.json`, `${m[1]}.data.js`] : [];
}

/**
 * Best-effort read of an asset's `meta.dimensions` from its source — a plain
 * literal match, no parser (the prompt only needs the numbers as a hint).
 *
 * @param {string} source
 * @returns {{ width: number, height: number } | null}
 */
export function dimensionsFromSource(source) {
    const m = /dimensions\s*:\s*\{\s*width\s*:\s*(\d+)\s*,\s*height\s*:\s*(\d+)/.exec(String(source ?? ''));
    return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * The canonical `.lerret/<rel>` paths the agent may write WITHOUT asking while
 * an asset is selected: the selected source file and its companion data
 * files. Null when the scope is not a single selected file (no restriction).
 *
 * @param {object|undefined} scope
 * @returns {Set<string> | null}
 */
export function selectionWritePaths(scope) {
    if (!scope || typeof scope !== 'object' || scope.kind !== 'file') return null;
    const rel = toProjectRelativeLerretPath(scope.filePath);
    if (!rel) return null;
    const assetPath = `.lerret/${rel.replace(/^\/+/, '')}`;
    return new Set([assetPath, ...dataFilePathsFor(assetPath)]);
}

/**
 * Read the selection-scoped file through the sandbox. The chip's filePath is
 * project-relative (a LerretPath); the sandbox speaks `.lerret/`-prefixed
 * relative paths — try the prefixed form first, then the verbatim one.
 * Returns null when there is no file scope, no sandbox, or the read fails
 * (the caller then prompts without file context, exactly the pre-fix
 * behavior — graceful degradation, never an error turn).
 *
 * @param {object|undefined} scope - The turn's scope (`state.scope`).
 * @param {object|undefined} sandbox - core/fs sandbox (read surface used only).
 * @returns {Promise<{
 *   path: string,
 *   content: string,
 *   truncated: boolean,
 *   dimensions: { width: number, height: number } | null,
 *   variant: string | null,
 *   data: { path: string, content: string } | null,
 * } | null>}
 */
export async function readScopedFile(scope, sandbox) {
    if (!sandbox || !scope || typeof scope !== 'object') return null;
    if (scope.kind !== 'file' || typeof scope.filePath !== 'string' || !scope.filePath) return null;
    // Prefer the normalized `.lerret/<rel>` form (handles the CLI runtime's
    // absolute chip paths), keep the verbatim path as the fallback candidate.
    const rel = toProjectRelativeLerretPath(scope.filePath);
    const candidates = [...new Set([`.lerret/${rel}`, scope.filePath])];
    for (const path of candidates) {
        try {
            if (!(await sandbox.exists(path))) continue;
            const raw = await sandbox.readFile(path, { encoding: 'utf-8' });
            const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
            return {
                path,
                content: content.slice(0, SCOPED_FILE_CHAR_CAP),
                truncated: content.length > SCOPED_FILE_CHAR_CAP,
                dimensions: dimensionsFromSource(content),
                variant: typeof scope.variant === 'string' && scope.variant ? scope.variant : null,
                data: await readCompanionData(path, sandbox),
            };
        } catch {
            // Violation / read error → try the next candidate, else no context.
        }
    }
    return null;
}

/**
 * Read the selected asset's companion data file (`.data.json`, else
 * `.data.js`), so text edits can target the data the asset actually renders.
 * Null when there is none or it can't be read.
 *
 * @param {string} assetPath
 * @param {object} sandbox
 * @returns {Promise<{ path: string, content: string } | null>}
 */
async function readCompanionData(assetPath, sandbox) {
    for (const path of dataFilePathsFor(assetPath)) {
        try {
            if (!(await sandbox.exists(path))) continue;
            const raw = await sandbox.readFile(path, { encoding: 'utf-8' });
            const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
            return { path, content: content.slice(0, SCOPED_DATA_CHAR_CAP) };
        } catch {
            // Unreadable data file → no data context, never an error turn.
        }
    }
    return null;
}

/**
 * The selection's structured context as prompt text — size, variant, the
 * truncation flag, and the companion data file — shared by every agent that
 * folds the selection into its prompt. Empty string for no selection.
 *
 * @param {Awaited<ReturnType<typeof readScopedFile>>} scopedFile
 * @returns {string}
 */
export function describeScopedFile(scopedFile) {
    if (!scopedFile) return '';
    const lines = [];
    if (scopedFile.dimensions) {
        lines.push(`Artboard size: ${scopedFile.dimensions.width}×${scopedFile.dimensions.height}px.`);
    }
    if (scopedFile.variant && scopedFile.variant !== 'default') {
        lines.push(
            `The user selected the "${scopedFile.variant}" variant (the export named ${scopedFile.variant}); ` +
                `apply the request to that variant unless it says otherwise.`,
        );
    }
    if (scopedFile.truncated) {
        lines.push(
            `The source below is TRUNCATED at ${SCOPED_FILE_CHAR_CAP} characters. Do not rewrite the whole ` +
                `file from it — the missing tail would be lost. Ask the user to split the asset instead.`,
        );
    }
    let out = lines.length ? `\n${lines.join(' ')}` : '';
    if (scopedFile.data) {
        out +=
            `\nIts TEXT lives in the companion data file — edit that file for wording changes:\n` +
            `--- ${scopedFile.data.path} (current content) ---\n${scopedFile.data.content}\n--- end ---`;
    }
    return out;
}

/**
 * The element-pinpoint sentence shared by both agents: the exact node the
 * user clicked inside the selected artboard (`scope.element` — `{text, tag}`
 * captured by the canvas, Epic 8 retro addendum 2). Empty string when the
 * scope carries no usable element.
 *
 * @param {object|undefined} scope
 * @returns {string}
 */
export function elementPinpoint(scope) {
    const el = scope && typeof scope === 'object' ? scope.element : null;
    if (!el || typeof el.text !== 'string' || !el.text.trim()) return '';
    return (
        `\nThe user clicked the ${el.tag ? `<${el.tag}> ` : ''}element containing ` +
        `"${el.text.trim().slice(0, 80)}" inside this asset — the request targets that ` +
        `element specifically.`
    );
}
