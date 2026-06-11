/**
 * vision-attach-button.jsx — the dock's image-attachment affordance with the
 * v1 reactive disabled-with-reason pattern (Story 8.7, AC-5/6).
 *
 * When the ACTIVE provider's model lacks vision per the Story 8.1 capability
 * matrix, the button renders disabled with the verbatim tooltip:
 *
 *   Active model can't see images. Configure a cloud provider in settings to enable vision.
 *
 * The disabling is REACTIVE: the capability re-evaluates whenever the
 * ai-context active provider / model changes (no reload, no remount) — a
 * provider switch in the settings panel re-enables the control the moment the
 * newly-active model is vision-capable.
 *
 * Capability resolution reaches @lerret/ai ONLY via `getAi()` (lazy.js) —
 * never a static import (no-static-imports invariant). FAIL-CLOSED defaults:
 * while the module is loading, when `getAi()` resolves null (AI not
 * installed), when `ai.vision` is absent, or when NO provider is active, the
 * button stays disabled with the same reason — an image can never be attached
 * toward a model that cannot (or will never) see it.
 *
 * When enabled, clicking opens an image file picker; the picked files are
 * filtered to image/* MIME (non-images are skipped; when ALL are skipped,
 * `onAttach` is not called) and each accepted file's bytes are encoded to
 * base64 BEFORE the selection is reported via `onAttach(attachments)` — the
 * callback fires asynchronously once every encode completes, preserving pick
 * order. Each attachment carries BOTH the studio (`kind: 'image'`) and
 * orchestrator (`type: 'image'`) discriminants plus the `mimeType`, so
 * `ai.vision.isVisionRequired` and the Planner's heuristic both recognize it,
 * and the bytes ride along as base64/dataUrl for the provider call.
 */

import React from 'react';

import { getAi } from './lazy.js';
import { useAiContext } from './ai-context.jsx';

/**
 * The verbatim disabled-with-reason tooltip (AC-5) — the user-facing contract.
 * Do not paraphrase.
 *
 * @type {string}
 */
export const VISION_ATTACH_DISABLED_TOOLTIP =
    "Active model can't see images. Configure a cloud provider in settings to enable vision.";

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('vision-attach-button-styles')) {
    const s = document.createElement('style');
    s.id = 'vision-attach-button-styles';
    s.textContent = `
.lm-vision-attach {
    display: inline-flex;
    align-items: center;
}
.lm-vision-attach__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--lm-text-secondary, #44403A);
    border-radius: 6px;
    flex-shrink: 0;
    padding: 0;
}
.lm-vision-attach__btn:hover:not(:disabled) {
    background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-vision-attach__btn:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 1px;
}
.lm-vision-attach__btn:disabled {
    color: var(--lm-mist, #B8B3A8);
    cursor: default;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Base64 encoding ──────────────────────────────────────────────────────────

/**
 * Encode a byte buffer to base64. The binary string is built with
 * String.fromCharCode over 0x8000-byte chunks (a single apply over a large
 * image would blow the engine's argument limit), then ONE btoa over the whole
 * string — chunked btoa would inject padding mid-stream and corrupt the
 * output.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The image-attach affordance for the dock input cluster.
 *
 * @param {object} props
 * @param {(attachments: Array<{ kind: 'image', type: 'image', mimeType: string, name: string, file: File, base64: string, dataUrl: string }>) => void} [props.onAttach]
 *   Receives the picked images as attachment objects ready for
 *   `runTurn({ attachments })` / `ai.vision.isVisionRequired(...)`. Fires
 *   AFTER the picked bytes are base64-encoded (async), in pick order; only
 *   image/* files are reported (no call when every pick was filtered out).
 */
export function VisionAttachButton({ onAttach }) {
    const { activeProvider, providerConfigs } = useAiContext();
    const fileRef = React.useRef(null);
    const describedById = React.useId();

    const activeModel = React.useMemo(
        () => providerConfigs.find((c) => c.providerName === activeProvider)?.model,
        [providerConfigs, activeProvider],
    );

    // Reactive capability resolution: re-runs whenever the active (provider,
    // model) pair changes (AC-6). Fail-closed `false` until proven otherwise.
    const [canSeeImages, setCanSeeImages] = React.useState(false);
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!activeProvider) {
                if (!cancelled) setCanSeeImages(false);
                return;
            }
            const ai = await getAi();
            const sees =
                ai?.vision && typeof ai.vision.supportsVision === 'function'
                    ? ai.vision.supportsVision(activeProvider, activeModel) === true
                    : false;
            if (!cancelled) setCanSeeImages(sees);
        })();
        return () => {
            cancelled = true;
        };
    }, [activeProvider, activeModel]);

    const disabled = !canSeeImages;

    const openPicker = React.useCallback(() => {
        fileRef.current?.click();
    }, []);

    const onFilesChosen = React.useCallback(
        (e) => {
            // Only image/* files may attach toward a vision call — anything
            // else (text, PDFs, empty-MIME unknowns) is skipped.
            const files = Array.from(e.target.files ?? []).filter(
                (f) => typeof f.type === 'string' && f.type.startsWith('image/'),
            );
            // Allow re-picking the same file on a subsequent open. (Cleared
            // BEFORE the async encodes — the input must not hold the stale
            // selection while the bytes are read.)
            e.target.value = '';
            if (files.length === 0 || typeof onAttach !== 'function') return;
            (async () => {
                // Sequential encode preserves pick order and bounds memory;
                // onAttach fires ONCE after every accepted file is encoded.
                const items = [];
                for (const f of files) {
                    let base64;
                    try {
                        base64 = arrayBufferToBase64(await f.arrayBuffer());
                    } catch {
                        // Unreadable file → skip it; the rest still attach.
                        continue;
                    }
                    items.push({
                        kind: 'image',
                        type: 'image',
                        mimeType: f.type,
                        name: f.name,
                        file: f,
                        base64,
                        dataUrl: `data:${f.type};base64,${base64}`,
                    });
                }
                if (items.length > 0) onAttach(items);
            })();
        },
        [onAttach],
    );

    return (
        <span className="lm-vision-attach" data-testid="vision-attach">
            <button
                type="button"
                className="lm-vision-attach__btn"
                data-testid="vision-attach-button"
                disabled={disabled}
                aria-label="Attach image"
                aria-describedby={disabled ? describedById : undefined}
                title={disabled ? VISION_ATTACH_DISABLED_TOOLTIP : 'Attach image'}
                onClick={openPicker}
            >
                {/* Minimal image glyph — mountain-in-frame, mirrors the dock's stroke icons. */}
                <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
                    <circle cx="5" cy="5.2" r="1.1" />
                    <path d="M2.5 10.5l3-3 2.2 2.2 2.1-2.1 1.7 1.7" />
                </svg>
            </button>
            {disabled && (
                <span id={describedById} hidden data-testid="vision-attach-reason">
                    {VISION_ATTACH_DISABLED_TOOLTIP}
                </span>
            )}
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                data-testid="vision-attach-input"
                onChange={onFilesChosen}
            />
        </span>
    );
}

export default VisionAttachButton;
