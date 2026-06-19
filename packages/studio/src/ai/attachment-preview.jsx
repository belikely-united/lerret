/**
 * attachment-preview.jsx — staged-image preview strip for the dock AI input.
 *
 * The VisionAttachButton stages picked images into the cluster's
 * `pendingAttachments`, but until now nothing rendered them: a user who
 * attached a brand logo (or two) got zero feedback on WHAT would ride the next
 * turn, and no way to drop one before sending. This strip closes that gap — a
 * row of thumbnails, each with a remove (×), shown while images are staged and
 * cleared the moment the turn consumes them.
 *
 * Dock-escape: like VisionFallbackPrompt, it PORTALS to <body> and is
 * `position: fixed`, pinned 8px above the measured dock rect. It must NOT live
 * inside the dock — the dock (`[data-tour="dock"]`) has `overflow: auto` +
 * `maxWidth` + a `backdrop-filter` containing block, so anything positioned
 * inside it is clipped/contained and renders invisibly. Same anchor math as the
 * vision / clarify / continue overlays (bottom: innerHeight - top).
 */

import React from 'react';
import { createPortal } from 'react-dom';

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('attachment-preview-styles')) {
    const s = document.createElement('style');
    s.id = 'attachment-preview-styles';
    s.textContent = `
.lm-attach-preview {
    /* Portaled to <body> + position:fixed (left/bottom set inline from the
       measured dock rect) — see the dock-escape note in the module header. */
    position: fixed;
    z-index: 60;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lm-space-2, 8px);
    max-width: 360px;
    padding: var(--lm-space-2, 8px) var(--lm-space-3, 10px);
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-border-light, #E8E2D4);
    border-radius: var(--lm-radius-md, 8px);
    box-shadow: var(--lm-shadow-sm, 0 4px 12px rgba(26, 23, 20, 0.10));
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
}
.lm-attach-preview__item {
    position: relative;
    width: 44px;
    height: 44px;
    flex: none;
}
.lm-attach-preview__thumb {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: var(--lm-radius-sm, 6px);
    overflow: hidden;
    border: 1px solid var(--lm-border, #D8D2C4);
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-attach-preview__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.lm-attach-preview__remove {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--lm-border-light, #E8E2D4);
    background: var(--lm-bg-primary, #FAF8F2);
    color: var(--lm-text-secondary, #44403A);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(26, 23, 20, 0.18);
    transition: background var(--lm-duration-fast, 120ms), color var(--lm-duration-fast, 120ms);
}
.lm-attach-preview__remove:hover {
    background: var(--lm-error, #A8412B);
    color: #fff;
    border-color: var(--lm-error, #A8412B);
}
.lm-attach-preview__remove:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 1px;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The staged-image preview strip.
 *
 * @param {object} props
 * @param {Array<{ name?: string, dataUrl?: string, mimeType?: string }>} props.attachments
 *   The images staged for the next turn (the cluster's `pendingAttachments`).
 *   Renders nothing when empty.
 * @param {(index: number) => void} props.onRemove
 *   Drop the attachment at `index` from the staged set.
 */
export function AttachmentPreview({ attachments, onRemove }) {
    const list = Array.isArray(attachments) ? attachments : [];
    const count = list.length;

    // Self-measured anchor: pinned 8px above the dock, left-aligned + clamped
    // into the viewport. Same dock-escape as VisionFallbackPrompt — the strip
    // shows pre-turn (while staging), so it can't reuse the running-gated
    // dockOverlayPos; it measures the dock here on mount + on resize/scroll.
    const [pos, setPos] = React.useState(
        /** @type {{ left: number, bottom: number } | null} */ (null),
    );

    React.useLayoutEffect(() => {
        if (count === 0) return undefined;
        const measure = () => {
            const anchor =
                document.querySelector('[data-tour="dock"]') ||
                document.querySelector('.lm-ai-cluster');
            if (!anchor) return;
            const r = anchor.getBoundingClientRect();
            const STRIP_MAX = 360; // matches .lm-attach-preview max-width
            const left = Math.max(8, Math.min(r.left, window.innerWidth - STRIP_MAX - 8));
            setPos({
                left: Math.round(left),
                bottom: Math.round(window.innerHeight - r.top + 8),
            });
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [count]);

    if (count === 0) return null;

    return createPortal(
        <div
            className="lm-attach-preview"
            role="group"
            aria-label={`${count} attached image${count === 1 ? '' : 's'}`}
            data-testid="attachment-preview"
            style={{ left: pos?.left ?? 16, bottom: pos?.bottom ?? 80 }}
        >
            {list.map((att, idx) => (
                <span
                    className="lm-attach-preview__item"
                    key={`${att && att.name ? att.name : 'img'}-${idx}`}
                    title={att && att.name ? att.name : 'attached image'}
                >
                    <span className="lm-attach-preview__thumb">
                        <img
                            className="lm-attach-preview__img"
                            src={att && att.dataUrl ? att.dataUrl : undefined}
                            alt={att && att.name ? att.name : 'attached image'}
                        />
                    </span>
                    <button
                        type="button"
                        className="lm-attach-preview__remove"
                        data-testid="attachment-remove"
                        aria-label={`Remove ${att && att.name ? att.name : 'image'}`}
                        onClick={() => onRemove && onRemove(idx)}
                    >
                        <svg
                            width="9"
                            height="9"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <path d="M2 2l6 6M8 2l-6 6" />
                        </svg>
                    </button>
                </span>
            ))}
        </div>,
        document.body,
    );
}

export default AttachmentPreview;
