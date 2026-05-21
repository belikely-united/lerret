// vars-injector.jsx — injects a folder's effective `vars` config block as CSS
// custom properties scoped to each asset's artboard wrapper (FR20,
// FR21).
//
// ── How it works ──────────────────────────────────────────────────────────
// Each entry in the effective config's `vars` block is turned into a CSS
// custom property `--<key>` applied via React's `style` prop on the artboard's
// inner wrapper element. React accepts custom property names in the `style`
// prop object directly (e.g. `{ '--brandColor': '#B85B33' }`). This scopes the
// property to the artboard subtree, so the asset's CSS can reference it with
// `var(--brandColor)` without any global injection.
//
// ── Cascade source ────────────────────────────────────────────────────────
// `VarsWrapper` is a React component (so it can call hooks). It calls
// `useCascadedConfig()` to get the effective config for the asset's owning
// folder path, then builds the custom-property style object and merges it with
// the caller-supplied `style`.
//
// ── Owning folder path ────────────────────────────────────────────────────
// An asset's `path` is `<folder>/<filename>`. Stripping the filename segment
// (everything after the last `/`) gives the direct parent folder path — which
// is the key the cascade map uses for effective configs.
//
// ── Key validation ────────────────────────────────────────────────────────
// CSS custom property names are `--<ident>`. The `<ident>` part must satisfy
// the CSS identifier grammar. We use a permissive but correct check:
//
// /^[A-Za-z_][A-Za-z0-9_-]*$/
//
// - Must start with a letter (A-Z, a-z) or underscore.
// - Subsequent characters may be letters, digits, underscores, or hyphens.
// - Max length 200 characters (sanity cap; no real-world key needs more).
//
// This excludes digits-as-first-char and special characters (which would
// produce invalid `--<key>` names that browsers silently ignore). A key that
// fails the check is skipped with a `console.warn` naming the key; all valid
// entries are still injected.
//
// ── Usage ─────────────────────────────────────────────────────────────────
// <VarsWrapper folderPath="/path/to/folder" style={existingStyle}>
// {children}
// </VarsWrapper>
//
// The `folderPath` is the asset's direct parent folder — computed from the
// asset's `path` in `artboardForEntry`.

import React from 'react';
import { useCascadedConfig } from './cascade-context.jsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum allowed length for a `vars` key (the CSS ident segment). Keys longer
 * than this are skipped as invalid. 200 characters is a generous cap — no
 * real design-token key needs more, and very long keys are almost certainly
 * typos or injected data.
 *
 * @type {number}
 */
const MAX_KEY_LENGTH = 200;

/**
 * Regex for a valid CSS custom-property identifier segment.
 *
 * Matches: first char `[A-Za-z_]`, subsequent chars `[A-Za-z0-9_-]*`.
 * This follows the CSS identifier grammar (`<ident-token>`) minus the
 * leading-hyphen forms (e.g. `-webkit-`) which are not useful for user-defined
 * vars. The full custom property name is `--<key>`; the browser requires the
 * ident part to be a valid CSS identifier, which this regex enforces.
 *
 * @type {RegExp}
 */
const VALID_CSS_IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// ---------------------------------------------------------------------------
// Core: build the CSS custom-property style object from a `vars` block
// ---------------------------------------------------------------------------

/**
 * Convert a `vars` config block into a React `style`-compatible object of CSS
 * custom properties (`{ '--key': 'value', ... }`).
 *
 * Invalid keys (empty string, fails the ident regex, or exceeds the max
 * length) are **skipped** with a `console.warn` naming the key. All valid
 * entries are still included.
 *
 * If `vars` is absent, null, not a plain object, or an array, returns `null`
 * (no custom properties to inject).
 *
 * @param {unknown} vars The raw `vars` value from the effective config.
 * @param {string} [folderPath] The folder path — included in warn messages.
 * @returns {Record<string, string> | null}
 * A plain object of `'--key': value` pairs, or `null` when there is nothing
 * to inject.
 */
export function buildVarsStyle(vars, folderPath = '<unknown>') {
 if (
 !vars ||
 typeof vars !== 'object' ||
 Array.isArray(vars)
 ) {
 return null;
 }

 /** @type {Record<string, string>} */
 const styleProps = {};
 let hasAny = false;

 for (const [key, value] of Object.entries(vars)) {
 // --- Validate the key ---
 if (typeof key !== 'string' || key.length === 0) {
 console.warn(
 `[lerret/vars] Skipping empty vars key at "${folderPath}" — ` +
 `CSS custom property names require a non-empty identifier segment.`,
 );
 continue;
 }
 if (key.length > MAX_KEY_LENGTH) {
 console.warn(
 `[lerret/vars] Skipping vars key "${key}" at "${folderPath}" — ` +
 `key exceeds the ${MAX_KEY_LENGTH}-character limit for a CSS custom property identifier.`,
 );
 continue;
 }
 if (!VALID_CSS_IDENT.test(key)) {
 console.warn(
 `[lerret/vars] Skipping vars key "${key}" at "${folderPath}" — ` +
 `"${key}" is not a valid CSS custom property identifier segment. ` +
 `Keys must start with a letter or underscore and contain only letters, ` +
 `digits, underscores, and hyphens (e.g. "brandColor", "max_width", "color-accent").`,
 );
 continue;
 }

 // --- Accept the entry ---
 styleProps[`--${key}`] = String(value);
 hasAny = true;
 }

 return hasAny ? styleProps : null;
}

// ---------------------------------------------------------------------------
// Helper: derive the owning folder path from an asset's full path
// ---------------------------------------------------------------------------

/**
 * Derive the parent folder path from an asset's full `LerretPath`.
 *
 * An asset path looks like `<folder>/<filename>` (forward-slash separators).
 * Stripping the filename segment gives the folder path — which is the key
 * used in the cascade map.
 *
 * Returns an empty string `''` for a path with no `/` (shouldn't happen in a
 * well-formed model, but degrades safely: `getConfigFor('')` returns `{}`).
 *
 * @param {string} assetPath The asset's full `LerretPath`.
 * @returns {string} The parent folder path.
 */
export function assetFolderPath(assetPath) {
 if (typeof assetPath !== 'string') return '';
 const lastSlash = assetPath.lastIndexOf('/');
 return lastSlash < 0 ? '' : assetPath.slice(0, lastSlash);
}

// ---------------------------------------------------------------------------
// VarsWrapper — React component that applies vars as CSS custom properties
// ---------------------------------------------------------------------------

/**
 * Wraps artboard content with CSS custom properties derived from the cascade's
 * `vars` block for the given folder path.
 *
 * This is a React **component** (not a plain function) so it can call
 * `useCascadedConfig()`. It merges the custom-property style with the
 * caller-supplied `style` prop and renders a single `<div>` wrapper.
 *
 * @param {object} props
 * @param {string} [props.folderPath]
 * The asset's owning folder path — used to look up the effective `vars` from
 * the cascade. When absent or not in the cascade, no custom properties are
 * added.
 * @param {React.CSSProperties} [props.style]
 * Base style for the wrapper div — typically the artboard's inner
 * `position: relative` wrapper style. Custom properties are merged in.
 * @param {React.ReactNode} props.children
 * @returns {React.ReactElement}
 */
export function VarsWrapper({ folderPath, style, children }) {
 const getConfigFor = useCascadedConfig();

 // Look up the effective config for this folder. The cascade always returns
 // at least `{}` (the context default), so this is safe without null-checks.
 const effectiveCfg = folderPath ? getConfigFor(folderPath) : {};

 // Build the CSS custom-property style object. Returns null when no valid
 // vars are present (no entry, empty vars block, all keys invalid).
 const varsStyle = buildVarsStyle(effectiveCfg.vars, folderPath);

 // Merge: custom properties from vars + the caller's existing style.
 // Custom properties go first so the caller's `style` can override them
 // if needed (though in practice the caller style is positional, not vars).
 const mergedStyle = varsStyle ? { ...varsStyle, ...style } : style;

 return <div style={mergedStyle}>{children}</div>;
}

export default VarsWrapper;
