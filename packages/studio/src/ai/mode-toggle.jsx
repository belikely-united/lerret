/**
 * mode-toggle.jsx — the `Ask / Inspect` mode switch for the dock AI input
 * cluster (Story 8.9, FR58).
 *
 * A self-contained, CONTROLLED ghost-tier segmented switch. The user flips
 * between two MODES of the one AI input — read-write (`Ask`) and read-only
 * (`Inspect`). Per FR57 + ADR-005's implicit ninth decision the multi-agent
 * topology stays invisible: the two labels are exactly `Ask` and `Inspect` —
 * never "Inspector", "Worker", or any agent name.
 *
 * ── Integration contract (Story 8.2's cluster mounts this) ──────────────────
 *   <ModeToggle value={mode} onChange={setMode} disabled={running} />
 *
 *   - `value`    'ask' | 'inspect' (anything else normalizes to 'ask').
 *   - `onChange` called with the NEXT mode string; only fires on a real
 *                change (clicking the selected option is a no-op).
 *   - `disabled` blocks pointer + keyboard interaction (e.g. while a turn
 *                runs, or when @lerret/ai is absent — the toggle still
 *                RENDERS so the chrome stays calm, it just goes inert).
 *
 *   The cluster derives the input placeholder from the mode: `Ask` keeps the
 *   Story 8.2 placeholder; `Inspect` uses {@link INSPECT_PLACEHOLDER}. On
 *   submit the cluster passes `mode` into `ai.runTurn({ ..., mode })` — the
 *   field is additive and back-compatible (absent → 'ask'). The
 *   {@link useInspectMode} hook bundles that state + the derived placeholder
 *   for the cluster.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────
 * A two-option `radiogroup` with roving tabindex: Tab enters the group on the
 * selected option; ArrowLeft/Right/Up/Down flips to the other option (cyclic,
 * standard radio-group keys); Home/End jump to Ask/Inspect. Selection state is
 * announced via `aria-checked`.
 *
 * ── Calm motion ──────────────────────────────────────────────────────────────
 * The only motion is a 120ms background/color tween on the selected segment,
 * gated behind `prefers-reduced-motion` (instant fallback) — mirroring the
 * cluster's pill discipline.
 */

import React from 'react';

// ─── Mode constants ───────────────────────────────────────────────────────────

/** The read-write default mode. */
export const MODE_ASK = 'ask';
/** The read-only inspect mode (FR58). */
export const MODE_INSPECT = 'inspect';
/** Both modes, in display order. */
export const MODES = Object.freeze([MODE_ASK, MODE_INSPECT]);

/**
 * The Inspect-mode input placeholder (spec AC-2). The cluster swaps its
 * placeholder to this string while the toggle is on `Inspect`.
 *
 * @type {string}
 */
export const INSPECT_PLACEHOLDER = 'Ask Lerret about your project…';

/**
 * Normalize an arbitrary value to a valid mode — anything that is not
 * exactly `'inspect'` is `'ask'` (the safe, read-write default never
 * silently becomes the read-only mode; the read-only mode is opt-in).
 *
 * @param {unknown} value
 * @returns {'ask' | 'inspect'}
 */
export function normalizeMode(value) {
    return value === MODE_INSPECT ? MODE_INSPECT : MODE_ASK;
}

// ─── Reduced-motion hook ──────────────────────────────────────────────────────

/**
 * Read `prefers-reduced-motion: reduce` reactively. jsdom stubs matchMedia in
 * tests; when matchMedia is absent the hook defaults to "no reduction".
 * (Local copy of the cluster's hook — this module is self-contained so Story
 * 8.2 can mount it without new shared plumbing.)
 *
 * @returns {boolean}
 */
function useReducedMotion() {
    const get = () => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
        } catch {
            return false;
        }
    };
    const [reduced, setReduced] = React.useState(get);
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        let mql;
        try {
            mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        } catch {
            return undefined;
        }
        const onChange = () => setReduced(get());
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
        return undefined;
    }, []);
    return reduced;
}

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('lm-ai-mode-toggle-styles')) {
    const s = document.createElement('style');
    s.id = 'lm-ai-mode-toggle-styles';
    s.textContent = `
.lm-ai-mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--lm-bg-secondary, #F2EEE6);
    flex-shrink: 0;
}
.lm-ai-mode-toggle__option {
    border: none;
    background: transparent;
    font: 500 11px/1.2 var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
    color: var(--lm-text-tertiary, #6E6960);
    padding: 3px 8px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
}
.lm-ai-mode-toggle__option[data-motion="animate"] {
    transition: background-color 120ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)),
        color 120ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
}
.lm-ai-mode-toggle__option[aria-checked="true"] {
    background: var(--lm-bg-primary, #FAF8F2);
    color: var(--lm-text-primary, #1A1714);
    box-shadow: var(--lm-shadow-xs, 0 1px 2px rgba(26, 23, 20, 0.08));
}
.lm-ai-mode-toggle__option:hover:not([aria-checked="true"]):not(:disabled) {
    color: var(--lm-text-secondary, #44403A);
}
.lm-ai-mode-toggle__option:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 1px;
}
.lm-ai-mode-toggle__option:disabled {
    cursor: default;
    opacity: 0.55;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Component ────────────────────────────────────────────────────────────────

const OPTIONS = Object.freeze([
    Object.freeze({ value: MODE_ASK, label: 'Ask', testid: 'ai-mode-ask' }),
    Object.freeze({ value: MODE_INSPECT, label: 'Inspect', testid: 'ai-mode-inspect' }),
]);

/**
 * The `Ask / Inspect` ghost-tier mode switch. Controlled — the parent owns the
 * mode (see {@link useInspectMode}).
 *
 * @param {object} props
 * @param {'ask' | 'inspect'} [props.value]   Current mode; defaults to 'ask'.
 * @param {(next: 'ask' | 'inspect') => void} [props.onChange]
 * @param {boolean} [props.disabled]
 */
export function ModeToggle({ value = MODE_ASK, onChange, disabled = false }) {
    const mode = normalizeMode(value);
    const reducedMotion = useReducedMotion();
    const optionRefs = {
        [MODE_ASK]: React.useRef(null),
        [MODE_INSPECT]: React.useRef(null),
    };

    const select = (next) => {
        if (disabled) return;
        if (next !== mode && typeof onChange === 'function') onChange(next);
    };

    const onKeyDown = (e) => {
        if (disabled) return;
        let next = null;
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
            // Two options: every arrow flips to the other (cyclic radio group).
            next = mode === MODE_ASK ? MODE_INSPECT : MODE_ASK;
        } else if (e.key === 'Home') {
            next = MODE_ASK;
        } else if (e.key === 'End') {
            next = MODE_INSPECT;
        }
        if (next == null) return;
        e.preventDefault();
        optionRefs[next].current?.focus();
        select(next);
    };

    return (
        <span
            className="lm-ai-mode-toggle"
            role="radiogroup"
            aria-label="AI input mode"
            aria-disabled={disabled || undefined}
            data-testid="ai-mode-toggle"
            data-mode={mode}
            onKeyDown={onKeyDown}
        >
            {OPTIONS.map((opt) => {
                const selected = opt.value === mode;
                return (
                    <button
                        key={opt.value}
                        ref={optionRefs[opt.value]}
                        type="button"
                        className="lm-ai-mode-toggle__option"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        disabled={disabled}
                        data-testid={opt.testid}
                        data-motion={reducedMotion ? 'instant' : 'animate'}
                        onClick={() => select(opt.value)}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </span>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Cluster-side mode state in one hook: the current mode, a normalizing
 * setter, the `isInspect` discriminant for submit plumbing
 * (`runTurn({ ..., mode })`), and the derived placeholder override
 * (`null` in Ask mode — the cluster keeps its own Ask placeholder, including
 * the narrow-window variant; the Inspect string replaces it wholesale).
 *
 * @param {'ask' | 'inspect'} [initial]
 * @returns {{
 *   mode: 'ask' | 'inspect',
 *   setMode: (next: unknown) => void,
 *   isInspect: boolean,
 *   placeholder: string | null,
 * }}
 */
export function useInspectMode(initial = MODE_ASK) {
    const [mode, setModeRaw] = React.useState(() => normalizeMode(initial));
    const setMode = React.useCallback((next) => setModeRaw(normalizeMode(next)), []);
    const isInspect = mode === MODE_INSPECT;
    return {
        mode,
        setMode,
        isInspect,
        placeholder: isInspect ? INSPECT_PLACEHOLDER : null,
    };
}

export default ModeToggle;
