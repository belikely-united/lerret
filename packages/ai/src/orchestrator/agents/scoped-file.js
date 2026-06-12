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

/** Max characters of a selection-scoped file folded into an agent prompt. */
export const SCOPED_FILE_CHAR_CAP = 12000;

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
 * Read the selection-scoped file through the sandbox. The chip's filePath is
 * project-relative (a LerretPath); the sandbox speaks `.lerret/`-prefixed
 * relative paths — try the prefixed form first, then the verbatim one.
 * Returns null when there is no file scope, no sandbox, or the read fails
 * (the caller then prompts without file context, exactly the pre-fix
 * behavior — graceful degradation, never an error turn).
 *
 * @param {object|undefined} scope - The turn's scope (`state.scope`).
 * @param {object|undefined} sandbox - core/fs sandbox (read surface used only).
 * @returns {Promise<{ path: string, content: string } | null>}
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
            return { path, content: content.slice(0, SCOPED_FILE_CHAR_CAP) };
        } catch {
            // Violation / read error → try the next candidate, else no context.
        }
    }
    return null;
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
