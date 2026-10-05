// selection-preview.js — a rendered image of the selected artboard, for the AI.
//
// When the user has an asset selected and sends a request, the agent should
// SEE what the user sees, not just read the source. This captures the selected
// artboard's card through the same `captureArtboard` the PNG export uses, at a
// size capped for a vision model, and hands back the attachment shape the
// orchestrator's `selectionPreview` input expects.
//
// Best-effort by design: any failure (no matching artboard, an artboard in an
// error state, a capture error, a slow capture) resolves `null` and the turn
// simply goes without the image.

import { captureArtboard } from '../export/capture.js';

/** Longest edge of the preview, in pixels — plenty for layout/colour/type. */
export const PREVIEW_MAX_EDGE = 1024;

/** Give up on a slow capture rather than hold the user's request. */
export const PREVIEW_TIMEOUT_MS = 4000;

/**
 * Find the selected artboard's slot element: the exact variant the user
 * clicked (`slotId`) when known, else the first artboard of that asset.
 *
 * @param {{ filePath?: string, slotId?: string }} scope
 * @param {ParentNode} [root]
 * @returns {HTMLElement | null}
 */
export function findSelectedSlot(scope, root = typeof document !== 'undefined' ? document : null) {
    if (!root || !scope || typeof scope.filePath !== 'string') return null;
    // Compare attributes in JS rather than building a selector, so any
    // character in a path or variant id is safe.
    const slots = [...root.querySelectorAll('[data-dc-asset-path]')].filter(
        (el) => el.getAttribute('data-dc-asset-path') === scope.filePath,
    );
    if (slots.length === 0) return null;
    if (scope.slotId) {
        const exact = slots.find((el) => el.getAttribute('data-dc-slot') === scope.slotId);
        if (exact) return exact;
    }
    return slots[0];
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>} The blob's bytes as base64 (no data-URL prefix).
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result ?? '');
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * Capture the selected artboard as a PNG attachment for the AI.
 *
 * @param {{ kind?: string, filePath?: string, slotId?: string } | null} scope
 * @param {{ capture?: typeof captureArtboard, root?: ParentNode, timeoutMs?: number }} [deps]
 *   Injectable for tests.
 * @returns {Promise<{ kind: 'image', name: string, mimeType: 'image/png', base64: string } | null>}
 */
export async function captureSelectionPreview(scope, deps = {}) {
    if (!scope || scope.kind !== 'file') return null;
    const { capture = captureArtboard, root, timeoutMs = PREVIEW_TIMEOUT_MS } = deps;
    try {
        const slot = findSelectedSlot(scope, root);
        const card = slot?.querySelector('.dc-card');
        if (!card) return null;
        const w = Number(slot.getAttribute('data-dc-w')) || card.offsetWidth || PREVIEW_MAX_EDGE;
        const h = Number(slot.getAttribute('data-dc-h')) || card.offsetHeight || PREVIEW_MAX_EDGE;
        const pixelRatio = Math.min(1, PREVIEW_MAX_EDGE / Math.max(w, h, 1));
        const result = await Promise.race([
            capture(card, { format: 'png', pixelRatio }),
            new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (!result?.blob) return null;
        return {
            kind: 'image',
            name: 'selected-artboard.png',
            mimeType: 'image/png',
            base64: await blobToBase64(result.blob),
        };
    } catch {
        return null;
    }
}
