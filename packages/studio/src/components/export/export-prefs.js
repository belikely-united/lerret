// export-prefs.js — remember the animated-export dialog's settings across
// opens, keyed per-asset with a global "last used" fallback.
//
// ── Where this lives ────────────────────────────────────────────────────────
// localStorage. These are UI PREFERENCES, not project data — we never write
// export settings into the user's `.lerret/` files (that would pollute their
// project + data files and sync noise into git). Per-asset persistence lets
// each artboard remember its own duration/fps/format/scale/loop; the global
// key seeds an asset you've never exported before with your latest choices, so
// the dialog feels consistent without forcing you to re-pick every time.
//
// ── Keying ──────────────────────────────────────────────────────────────────
// Per-asset key uses the artboard's stable `entry.id` (its LerretPath, e.g.
// `/proj/.lerret/live/clock.jsx`, or `…#variant`). Bulk export (no single
// asset) passes a null key and reads/writes only the global fallback.
//
// All reads/writes are wrapped in try/catch — localStorage can be absent (SSR),
// throw (Safari private mode), or be full (quota). A failure degrades to
// "no memory", never breaks the dialog.

const NS = 'lerret:anim-export:v1';
const GLOBAL_KEY = `${NS}:__last__`;
// `scale` is intentionally NOT persisted/restored: it was removed from the UI
// (the artboard's meta.dimensions are the authoritative export size). Exports
// are always 1×. Forcing it here also neutralizes any stale 2×/3× left in a
// user's localStorage from before the Scale control was removed.
const PERSIST_FIELDS = ['durationMs', 'fps', 'format', 'loop'];
const VALID_FORMATS = new Set(['webp', 'gif', 'apng', 'mp4']);

// Bounds mirror the dialog's numeric-input limits.
const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 60000;
const MIN_FPS = 1;
const MAX_FPS = 60;

function safeStorage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function readJson(key) {
    const s = safeStorage();
    if (!s) return null;
    try {
        const raw = s.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key, value) {
    const s = safeStorage();
    if (!s) return;
    try {
        s.setItem(key, JSON.stringify(value));
    } catch {
        // quota exceeded / private mode — silently skip; memory is best-effort.
    }
}

/**
 * Coerce an arbitrary stored object into a complete, valid settings object.
 * Every field is validated and falls back to the dialog default when missing
 * or out of range — so the result is always safe to drop straight into state.
 *
 * @param {Record<string, unknown> | null | undefined} raw
 * @returns {{ durationMs: number, fps: number, format: string, scale: number, loop: 'infinite'|'once'|number }}
 */
export function sanitizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};

    const d = Number(r.durationMs);
    const durationMs = Number.isFinite(d)
        ? Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(d)))
        : 3000;

    const f = Number(r.fps);
    const fps = Number.isFinite(f) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(f))) : 24;

    const format = VALID_FORMATS.has(/** @type {string} */ (r.format)) ? r.format : 'webp';

    // Always 1× — Scale was removed from the UI; the artboard's meta.dimensions
    // are authoritative. Hardcoding here also neutralizes any stale 2×/3× value
    // left in localStorage from before the control was removed.
    const scale = 1;

    const lp = r.loop;
    const loop =
        lp === 'infinite' || lp === 'once' || (Number.isInteger(lp) && /** @type {number} */ (lp) >= 0)
            ? lp
            : 'infinite';

    return { durationMs, fps, format, scale, loop };
}

/**
 * Load remembered export settings for an asset. Tries the per-asset entry
 * first, then the global "last used", then dialog defaults. Always returns a
 * complete, sanitized settings object.
 *
 * @param {string | null | undefined} assetKey  The artboard's stable id.
 * @returns {{ durationMs: number, fps: number, format: string, scale: number, loop: 'infinite'|'once'|number }}
 */
export function loadExportPrefs(assetKey) {
    const perAsset = assetKey ? readJson(`${NS}:${assetKey}`) : null;
    const src = perAsset || readJson(GLOBAL_KEY);
    return sanitizeSettings(src);
}

/**
 * Persist the export settings for an asset (and update the global "last used").
 * Only the stable, asset-independent fields are stored — never the filename
 * (that's derived from the asset name + format on open).
 *
 * @param {string | null | undefined} assetKey
 * @param {Record<string, unknown>} settings
 * @returns {void}
 */
export function saveExportPrefs(assetKey, settings) {
    const subset = {};
    for (const k of PERSIST_FIELDS) subset[k] = settings[k];
    const clean = sanitizeSettings(subset);
    if (assetKey) writeJson(`${NS}:${assetKey}`, clean);
    writeJson(GLOBAL_KEY, clean);
}
