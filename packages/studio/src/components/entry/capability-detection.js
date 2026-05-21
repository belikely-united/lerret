// capability-detection.js — feature-based File System Access API detection.
//
// requires that the entry routing decides which screen to show based
// on a *feature probe*, never a user-agent string. This module is the single
// source of truth for that decision so tests can stub it easily.
//
// Detection strategy:
// - Probe `window.showDirectoryPicker` — the primary entry point for the FSA.
// - Probe `window.FileSystemDirectoryHandle` — the handle class; its presence
// corroborates that the full API is available, not just the picker stub.
//
// Both must be present. This reliably captures Chromium >= 86 (Chrome, Edge,
// Opera) and correctly excludes Safari (which added partial FSA support in
// Safari 15.2 but never `showDirectoryPicker`) and Firefox (which ships none
// of this). It also degrades correctly on any future non-supporting browser
// without requiring a UA allowlist.

/**
 * Return `true` when the File System Access API is fully supported in the
 * current browsing context — specifically `showDirectoryPicker` and
 * `FileSystemDirectoryHandle` are both available as globals.
 *
 * **Never** uses `navigator.userAgent` or any UA string matching.
 *
 * @returns {boolean}
 */
export function isFileSystemAccessSupported() {
 return (
 typeof window !== 'undefined' &&
 typeof window.showDirectoryPicker === 'function' &&
 typeof window.FileSystemDirectoryHandle === 'function'
 );
}
