/**
 * attachment-preview.jsx — the floating "prompt-context tray" above the dock.
 *
 * Both a selection SCOPE and staged IMAGE attachments are the same category of
 * thing: context you're attaching to your next AI turn. So they float TOGETHER
 * in one card above the dock — the scope chip on top, the image thumbnails
 * below — instead of the scope being crammed into the dock pill while its images
 * float separately (that asymmetry read as "cramped"). The dock pill stays for
 * the durable controls only (brand · page · input · attach · status).
 *
 * `PromptContextTray` is a generic host: it takes a ready-made `scopeNode` (the
 * cluster owns the SelectionChip) + the staged `attachments`, and renders the
 * floating card. `AttachmentPreview` stays exported as a thin alias (scope-less)
 * for back-compat.
 *
 * Dock-escape: it PORTALS to <body> and is `position: fixed`, pinned 8px above
 * the measured dock rect. It must NOT live inside the dock — the dock
 * (`[data-tour="dock"]`) has `overflow: auto` + `maxWidth` + a `backdrop-filter`
 * containing block, so anything positioned inside it is clipped/contained and
 * renders invisibly. Same anchor math as the vision / clarify / continue
 * overlays (bottom: innerHeight - top).
 */

import React from 'react';
import { createPortal } from 'react-dom';

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('attachment-preview-styles')) {
    const s = document.createElement('style');
    s.id = 'attachment-preview-styles';
    s.textContent = `
.lm-ctx-tray {
    /* Portaled to <body> + position:fixed (left/bottom set inline from the
       measured dock rect) — see the dock-escape note in the module header. The
       card grows UPWARD from its pinned bottom edge as rows stack.
       CONNECTED look: it wears the SAME frosted material as the dock and sits
       FLUSH on its top edge (a slight overlap hides the seam — see useDockAnchor),
       with a rounded TOP + flat BOTTOM so it reads as the dock's upper section,
       not a separate floating card. */
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-2, 8px);
    box-sizing: border-box;
    padding: 8px 12px 10px;
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(16px) saturate(120%);
    -webkit-backdrop-filter: blur(16px) saturate(120%);
    border: none;
    /* Match the dock's 24px so the combined card+dock reads as ONE rounded
       rect: the card rounds the TOP, the dock rounds the BOTTOM, flat seam
       between (the dock flattens its top corners while the card is attached). */
    border-radius: 24px 24px 0 0;
    /* Soft lift ABOVE only — no downward shadow that would cast a seam onto the
       dock it sits on. The dock's own shadow grounds the combined unit. */
    box-shadow: 0 -3px 14px rgba(15, 23, 42, 0.07);
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
    /* Calm entrance: the card emerges UP out of the dock as it attaches (a brief
       slide + fade), gated behind reduced-motion below. Plays once on mount —
       re-anchoring (position updates) does not replay it. */
    animation: lm-ctx-tray-in 220ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}
@keyframes lm-ctx-tray-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}
/* The dock flattens its TOP corners when the card attaches (set inline in
   StudioDock) — ease that flatten/restore so connect/disconnect reads as one
   smooth motion with the card's slide, not an instant snap. */
[data-tour="dock"] {
    transition: border-top-left-radius 220ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)),
                border-top-right-radius 220ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
}
@media (prefers-reduced-motion: reduce) {
    .lm-ctx-tray { animation: none; }
    [data-tour="dock"] { transition: none; }
}
.lm-ctx-tray__scope {
    display: flex;
    min-width: 0;
}
/* In the tray the scope chip is no longer fighting the input for dock width, so
   it sheds the dock's truncation cap / hold-ground rules and shows the
   breadcrumb in full (the file stops collapsing to "We…"). */
.lm-ctx-tray .lm-ai-cluster__chip {
    max-width: 100%;
    flex-shrink: 1;
}
.lm-ctx-tray__images {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--lm-space-2, 8px);
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

// ─── Dock-anchored position hook ──────────────────────────────────────────────

/**
 * Self-measured anchor: pinned 8px above the dock, left-aligned + clamped into
 * the viewport. Same dock-escape as the vision / clarify overlays — the tray
 * shows pre-turn (while staging / scoped), so it owns its own measurement rather
 * than the running-gated dockOverlayPos. Re-measures on resize + scroll.
 *
 * @param {boolean} active - Whether the tray is currently rendered (skip work otherwise).
 * @returns {{ left: number, bottom: number } | null}
 */
function useDockAnchor(active) {
    const [pos, setPos] = React.useState(
        /** @type {{ left: number, bottom: number } | null} */ (null),
    );
    React.useLayoutEffect(() => {
        if (!active) return undefined;
        let rafRetry = 0;
        let rafSettle = 0;
        let tries = 0;
        let ro = /** @type {ResizeObserver | null} */ (null);
        const hasRaf = typeof requestAnimationFrame !== 'undefined';
        const getAnchor = () =>
            document.querySelector('[data-tour="dock"]') ||
            document.querySelector('.lm-ai-cluster');
        const measure = () => {
            const anchor = getAnchor();
            const r = anchor && anchor.getBoundingClientRect();
            // Anchor not in the DOM yet, or laid out at zero width (its
            // backdrop-filter / fonts still settling): RETRY next frame instead of
            // giving up. Giving up leaves `pos` null, and the tray then paints at
            // its fallback — a narrow, detached, mis-anchored pill that never
            // recovers (the "sometimes" broken look). A bounded retry self-heals.
            if (!r || r.width === 0) {
                if (tries++ < 30 && hasRaf) rafRetry = requestAnimationFrame(measure);
                return;
            }
            const next = {
                left: Math.round(r.left),
                // 2px OVERLAP onto the dock's top (not a gap) so the card and dock
                // read as one unit — the overlap + shared frosted material + matched
                // width + the dock flattening its top corners while attached (see
                // studio-shell) make them a single seamless rounded panel.
                bottom: Math.round(window.innerHeight - r.top - 2),
                // Match the dock's exact width so the join is a clean full-width
                // line; a narrower card notches against the dock's rounded corners.
                width: Math.round(r.width),
            };
            // Skip no-op updates so resize / scroll / observer churn doesn't
            // re-render the portal on every event.
            setPos((prev) =>
                prev && prev.left === next.left && prev.bottom === next.bottom && prev.width === next.width
                    ? prev
                    : next,
            );
        };
        measure();
        // One more pass after the first paint settles — fonts / async layout can
        // shift the dock after the synchronous mount measure.
        if (hasRaf) rafSettle = requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        // Re-anchor when the DOCK ITSELF changes height — e.g. the multi-line
        // input growing/shrinking pushes the dock top up/down, which fires no
        // window resize/scroll. The cluster signals it explicitly via this event.
        window.addEventListener('lerret:dock-resized', measure);
        // Real browsers honour ResizeObserver; it re-anchors on ANY dock size
        // change. (It's throttled to zero callbacks in embedded/background views —
        // that's why the custom event above exists as a backstop, not in its place.)
        const anchorEl = getAnchor();
        if (anchorEl && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(measure);
            ro.observe(anchorEl);
        }
        return () => {
            if (rafRetry) cancelAnimationFrame(rafRetry);
            if (rafSettle) cancelAnimationFrame(rafSettle);
            if (ro) ro.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('lerret:dock-resized', measure);
        };
    }, [active]);
    return pos;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The floating prompt-context tray.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.scopeNode] - The selection-scope chip to host
 *   (the cluster owns SelectionChip). Null/false → no scope row. The caller is
 *   responsible for gating it (e.g. hidden while a turn runs).
 * @param {Array<{ name?: string, dataUrl?: string, mimeType?: string }>} props.attachments
 *   The images staged for the next turn (the cluster's `pendingAttachments`).
 * @param {(index: number) => void} props.onRemove
 *   Drop the attachment at `index` from the staged set.
 */
export function PromptContextTray({ scopeNode, attachments, onRemove }) {
    const list = Array.isArray(attachments) ? attachments : [];
    const count = list.length;
    const hasScope = scopeNode != null && scopeNode !== false;
    const visible = hasScope || count > 0;
    const pos = useDockAnchor(visible);

    // Tell the dock whether the context card is attached, so it can flatten its
    // TOP corners to meet the card's flat bottom (one seamless rounded panel) and
    // restore them when the card is gone. (See StudioDock in studio-shell.)
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(
            new CustomEvent('lerret:dock-context', { detail: { present: visible } }),
        );
    }, [visible]);

    if (!visible) return null;

    // Until the dock is measured, keep the card invisible (and animation-free)
    // rather than flash it at the fallback geometry — a narrow, detached pill.
    // useDockAnchor self-heals within a frame, so this is a sub-frame guard in the
    // common case and the safety net in the rare measurement race.
    const anchored = pos != null;

    return createPortal(
        <div
            className="lm-ctx-tray"
            data-testid="prompt-context-tray"
            style={{
                left: pos?.left ?? 16,
                bottom: pos?.bottom ?? 80,
                width: pos?.width,
                visibility: anchored ? 'visible' : 'hidden',
                animation: anchored ? undefined : 'none',
            }}
        >
            {hasScope && (
                <div className="lm-ctx-tray__scope" data-testid="prompt-context-scope">
                    {scopeNode}
                </div>
            )}
            {count > 0 && (
                <div
                    className="lm-ctx-tray__images"
                    role="group"
                    aria-label={`${count} attached image${count === 1 ? '' : 's'}`}
                    data-testid="attachment-preview"
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
                </div>
            )}
        </div>,
        document.body,
    );
}

/**
 * Back-compat alias: the images-only tray. Existing callers/tests that render
 * just the staged-image strip pass `attachments` + `onRemove` (no scope).
 */
export const AttachmentPreview = PromptContextTray;

export default PromptContextTray;
