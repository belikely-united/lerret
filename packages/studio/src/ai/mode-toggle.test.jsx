// Tests for the Ask / Inspect mode toggle (Story 8.9). jsdom.
//
// The toggle is a self-contained CONTROLLED component — these tests pin the
// integration contract Story 8.2's cluster relies on:
//   - two options labeled exactly `Ask` / `Inspect` (no agent jargon, FR57),
//   - controlled value + onChange-only-on-real-change,
//   - radiogroup keyboard support (arrows flip, Home/End, roving tabindex),
//   - disabled inertness,
//   - reduced-motion gating,
//   - the useInspectMode hook (mode state + isInspect + placeholder override),
//   - the INSPECT_PLACEHOLDER constant the cluster swaps in.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
    ModeToggle,
    useInspectMode,
    normalizeMode,
    INSPECT_PLACEHOLDER,
    MODE_ASK,
    MODE_INSPECT,
    MODES,
} from './mode-toggle.jsx';

let container;
let root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    if ('matchMedia' in window) delete window.matchMedia;
});

function render(ui) {
    act(() => {
        root.render(ui);
    });
}

const $ = (testid) => container.querySelector(`[data-testid="${testid}"]`);

function click(el) {
    act(() => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
}

function keydown(el, key) {
    act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

describe('ModeToggle — render contract', () => {
    it('renders a radiogroup with exactly two options labeled Ask and Inspect — no agent jargon', () => {
        render(<ModeToggle value="ask" onChange={() => {}} />);
        const group = $('ai-mode-toggle');
        expect(group).toBeTruthy();
        expect(group.getAttribute('role')).toBe('radiogroup');
        const radios = group.querySelectorAll('[role="radio"]');
        expect(radios).toHaveLength(2);
        expect($('ai-mode-ask').textContent).toBe('Ask');
        expect($('ai-mode-inspect').textContent).toBe('Inspect');
        // FR57 / guardrail #8: the topology never leaks into the copy.
        expect(container.textContent).not.toMatch(/inspector|worker|planner|agent/i);
    });

    it('defaults to Ask: aria-checked + roving tabindex on the selected option', () => {
        render(<ModeToggle onChange={() => {}} />);
        const ask = $('ai-mode-ask');
        const inspect = $('ai-mode-inspect');
        expect(ask.getAttribute('aria-checked')).toBe('true');
        expect(inspect.getAttribute('aria-checked')).toBe('false');
        expect(ask.tabIndex).toBe(0);
        expect(inspect.tabIndex).toBe(-1);
        expect($('ai-mode-toggle').dataset.mode).toBe('ask');
    });

    it('is controlled: value="inspect" renders Inspect selected (and tabbable)', () => {
        render(<ModeToggle value="inspect" onChange={() => {}} />);
        expect($('ai-mode-inspect').getAttribute('aria-checked')).toBe('true');
        expect($('ai-mode-ask').getAttribute('aria-checked')).toBe('false');
        expect($('ai-mode-inspect').tabIndex).toBe(0);
        expect($('ai-mode-ask').tabIndex).toBe(-1);
        expect($('ai-mode-toggle').dataset.mode).toBe('inspect');
    });

    it('normalizes an unknown value prop to ask', () => {
        render(<ModeToggle value="banana" onChange={() => {}} />);
        expect($('ai-mode-ask').getAttribute('aria-checked')).toBe('true');
        expect($('ai-mode-toggle').dataset.mode).toBe('ask');
    });

    it('styles come from --lm- design tokens (scoped stylesheet injected once)', () => {
        render(<ModeToggle onChange={() => {}} />);
        const sheet = document.getElementById('lm-ai-mode-toggle-styles');
        expect(sheet).toBeTruthy();
        expect(sheet.textContent).toContain('var(--lm-');
        expect(document.querySelectorAll('#lm-ai-mode-toggle-styles')).toHaveLength(1);
    });
});

describe('ModeToggle — pointer interaction', () => {
    it('clicking the other option fires onChange with the next mode (once)', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} />);
        click($('ai-mode-inspect'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('inspect');
    });

    it('clicking back to Ask from Inspect fires onChange("ask")', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="inspect" onChange={onChange} />);
        click($('ai-mode-ask'));
        expect(onChange).toHaveBeenCalledWith('ask');
    });

    it('clicking the ALREADY-selected option does not fire onChange', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} />);
        click($('ai-mode-ask'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disabled: options carry the disabled attribute and clicks are inert', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} disabled />);
        expect($('ai-mode-ask').disabled).toBe(true);
        expect($('ai-mode-inspect').disabled).toBe(true);
        click($('ai-mode-inspect'));
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('ModeToggle — keyboard (radiogroup pattern)', () => {
    it('ArrowRight flips Ask → Inspect and moves focus to the Inspect option', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} />);
        const ask = $('ai-mode-ask');
        act(() => ask.focus());
        keydown(ask, 'ArrowRight');
        expect(onChange).toHaveBeenCalledWith('inspect');
        expect(document.activeElement).toBe($('ai-mode-inspect'));
    });

    it('ArrowLeft flips Inspect → Ask', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="inspect" onChange={onChange} />);
        keydown($('ai-mode-inspect'), 'ArrowLeft');
        expect(onChange).toHaveBeenCalledWith('ask');
        expect(document.activeElement).toBe($('ai-mode-ask'));
    });

    it('ArrowDown and ArrowUp also flip (two options — cyclic)', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} />);
        keydown($('ai-mode-ask'), 'ArrowDown');
        expect(onChange).toHaveBeenLastCalledWith('inspect');
        keydown($('ai-mode-ask'), 'ArrowUp');
        expect(onChange).toHaveBeenLastCalledWith('inspect');
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('Home selects Ask; End selects Inspect', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="inspect" onChange={onChange} />);
        keydown($('ai-mode-inspect'), 'Home');
        expect(onChange).toHaveBeenLastCalledWith('ask');

        const onChange2 = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange2} />);
        keydown($('ai-mode-ask'), 'End');
        expect(onChange2).toHaveBeenLastCalledWith('inspect');
    });

    it('Home/End on the already-selected option do not fire onChange (no-op change)', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} />);
        keydown($('ai-mode-ask'), 'Home');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('unrelated keys do nothing', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} />);
        keydown($('ai-mode-ask'), 'a');
        keydown($('ai-mode-ask'), 'Enter');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('disabled: arrow keys are inert', () => {
        const onChange = vi.fn();
        render(<ModeToggle value="ask" onChange={onChange} disabled />);
        keydown($('ai-mode-ask'), 'ArrowRight');
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('ModeToggle — reduced motion', () => {
    it('options animate by default (no matchMedia in jsdom → no reduction)', () => {
        render(<ModeToggle onChange={() => {}} />);
        expect($('ai-mode-ask').dataset.motion).toBe('animate');
    });

    it('prefers-reduced-motion: reduce → data-motion="instant"', () => {
        window.matchMedia = vi.fn().mockReturnValue({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        render(<ModeToggle onChange={() => {}} />);
        expect($('ai-mode-ask').dataset.motion).toBe('instant');
        expect($('ai-mode-inspect').dataset.motion).toBe('instant');
    });
});

describe('useInspectMode — the cluster-side state hook', () => {
    /** Render the hook + a controlled toggle; capture the latest hook state. */
    function HookProbe({ initial, capture }) {
        const state = useInspectMode(initial);
        capture(state);
        return <ModeToggle value={state.mode} onChange={state.setMode} />;
    }

    it('defaults to ask: isInspect false, placeholder null (cluster keeps its own Ask placeholder)', () => {
        let latest;
        render(<HookProbe capture={(s) => (latest = s)} />);
        expect(latest.mode).toBe('ask');
        expect(latest.isInspect).toBe(false);
        expect(latest.placeholder).toBeNull();
    });

    it('setMode("inspect") flips isInspect and yields the Inspect placeholder', () => {
        let latest;
        render(<HookProbe capture={(s) => (latest = s)} />);
        act(() => latest.setMode('inspect'));
        expect(latest.mode).toBe('inspect');
        expect(latest.isInspect).toBe(true);
        expect(latest.placeholder).toBe(INSPECT_PLACEHOLDER);
    });

    it('drives the toggle end-to-end: clicking Inspect updates the controlled value', () => {
        let latest;
        render(<HookProbe capture={(s) => (latest = s)} />);
        click($('ai-mode-inspect'));
        expect(latest.mode).toBe('inspect');
        expect($('ai-mode-inspect').getAttribute('aria-checked')).toBe('true');
        expect($('ai-mode-toggle').dataset.mode).toBe('inspect');
    });

    it('setMode normalizes garbage back to ask; initial prop is honored', () => {
        let latest;
        render(<HookProbe initial="inspect" capture={(s) => (latest = s)} />);
        expect(latest.mode).toBe('inspect');
        act(() => latest.setMode('worker'));
        expect(latest.mode).toBe('ask');
    });
});

describe('exports — the Story 8.2 integration contract surface', () => {
    it('INSPECT_PLACEHOLDER is the exact AC-2 string', () => {
        expect(INSPECT_PLACEHOLDER).toBe('Ask Lerret about your project…');
    });

    it('mode constants are frozen and exactly ask/inspect', () => {
        expect(MODE_ASK).toBe('ask');
        expect(MODE_INSPECT).toBe('inspect');
        expect(MODES).toEqual(['ask', 'inspect']);
        expect(Object.isFrozen(MODES)).toBe(true);
    });

    it('normalizeMode maps everything but "inspect" to "ask"', () => {
        expect(normalizeMode('inspect')).toBe('inspect');
        expect(normalizeMode('ask')).toBe('ask');
        expect(normalizeMode(undefined)).toBe('ask');
        expect(normalizeMode('INSPECT')).toBe('ask');
        expect(normalizeMode(1)).toBe('ask');
    });
});
