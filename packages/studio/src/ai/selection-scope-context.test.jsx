// Tests for the canvas selection-scope context (Story 8.2, Task 2).
//
// Coverage:
//   - The default value is a null scope with no-op setters (no provider).
//   - SelectionScopeProvider exposes setScope / clearScope and they mutate the
//     scope a consumer reads.
//   - The scope-builder helpers (fileScope / artboardsScope / pageScope) produce
//     the documented { kind, label, ... } shapes.
//   - setScope(null) and setScope({ kind: null }) both normalize to the null
//     scope (so "no selection" is a single representation the chip branches on).

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from 'vitest';

import {
    SelectionScopeProvider,
    useSelectionScope,
    fileScope,
    artboardsScope,
    pageScope,
} from './selection-scope-context.jsx';

function renderToDom(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(element));
    return {
        container,
        rerender(el) { act(() => root.render(el)); },
        cleanup() { act(() => root.unmount()); container.remove(); },
    };
}

// A probe component that exposes the context to the test via a ref-like sink.
function Probe({ sink }) {
    const ctx = useSelectionScope();
    sink.current = ctx;
    return (
        <div data-testid="probe-label">
            {ctx.scope ? ctx.scope.label : '(none)'}
        </div>
    );
}

describe('selection-scope helpers', () => {
    it('fileScope derives a basename label and carries the filePath', () => {
        const s = fileScope('pages/social/twitter-card.jsx');
        expect(s.kind).toBe('file');
        expect(s.label).toBe('twitter-card.jsx');
        expect(s.filePath).toBe('pages/social/twitter-card.jsx');
    });

    it('fileScope prefers an explicit (component-name) label when supplied', () => {
        const s = fileScope('pages/social/twitter-card.jsx', 'TwitterCard');
        expect(s.label).toBe('TwitterCard');
        expect(s.filePath).toBe('pages/social/twitter-card.jsx');
    });

    it('artboardsScope renders an "N artboards" label with the count', () => {
        const s = artboardsScope(3);
        expect(s).toEqual({ kind: 'artboards', count: 3, label: '3 artboards' });
    });

    it('pageScope renders a "<page> page" label', () => {
        expect(pageScope('Social').label).toBe('Social page');
    });
});

describe('SelectionScopeProvider', () => {
    it('defaults to a null scope outside any provider', () => {
        const sink = React.createRef();
        const { cleanup } = renderToDom(<Probe sink={sink} />);
        expect(sink.current.scope).toBeNull();
        // No-op setters must not throw.
        act(() => sink.current.setScope(fileScope('a/b.jsx')));
        expect(sink.current.scope).toBeNull();
        cleanup();
    });

    it('setScope updates the scope a consumer reads', () => {
        const sink = React.createRef();
        const { container, cleanup } = renderToDom(
            <SelectionScopeProvider><Probe sink={sink} /></SelectionScopeProvider>,
        );
        act(() => sink.current.setScope(fileScope('pages/x/card.jsx')));
        expect(container.querySelector('[data-testid="probe-label"]').textContent).toBe('card.jsx');
        cleanup();
    });

    it('clearScope removes the scope', () => {
        const sink = React.createRef();
        const { container, cleanup } = renderToDom(
            <SelectionScopeProvider><Probe sink={sink} /></SelectionScopeProvider>,
        );
        act(() => sink.current.setScope(pageScope('Social')));
        expect(container.querySelector('[data-testid="probe-label"]').textContent).toBe('Social page');
        act(() => sink.current.clearScope());
        expect(container.querySelector('[data-testid="probe-label"]').textContent).toBe('(none)');
        cleanup();
    });

    it('setScope(null) and setScope({kind:null}) normalize to the null scope', () => {
        const sink = React.createRef();
        const { cleanup } = renderToDom(
            <SelectionScopeProvider><Probe sink={sink} /></SelectionScopeProvider>,
        );
        act(() => sink.current.setScope(artboardsScope(2)));
        expect(sink.current.scope.kind).toBe('artboards');
        act(() => sink.current.setScope({ kind: null, label: 'ignored' }));
        expect(sink.current.scope).toBeNull();
        act(() => sink.current.setScope(artboardsScope(2)));
        act(() => sink.current.setScope(null));
        expect(sink.current.scope).toBeNull();
        cleanup();
    });
});
