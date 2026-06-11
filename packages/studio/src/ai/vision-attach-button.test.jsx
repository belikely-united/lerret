// Tests for the disabled-with-reason image-attach affordance (Story 8.7,
// AC-5/6). jsdom.
//
// Coverage:
//   - disabled + the VERBATIM tooltip when the active model is non-vision,
//   - enabled when the active provider's model is vision-capable,
//   - REACTIVE re-evaluation when the active-provider context value changes
//     (no remount of the button),
//   - fail-closed disabled when @lerret/ai is absent (getAi() → null),
//   - picking files reports {kind:'image', type:'image', mimeType} attachments
//     with the bytes encoded to base64/dataUrl (async, pick order preserved),
//   - non-image picks are filtered out (all-skipped → no onAttach call).
//
// The capability lookup is mocked at the lazy-import boundary
// (vi.mock('./lazy.js')) — the REAL matrix semantics are pinned by
// packages/ai/src/vision/router.test.js; here a tiny stub suffices (a static
// import of @lerret/ai from a studio test would violate the
// no-static-imports invariant).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── getAi() mock ──────────────────────────────────────────────────────────────
const aiMock = { current: /** @type {object | null} */ (null) };
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import { VisionAttachButton, VISION_ATTACH_DISABLED_TOOLTIP } from './vision-attach-button.jsx';
import { AiContextProvider } from './ai-context.jsx';

// ── Test infra ────────────────────────────────────────────────────────────────

let mounted = [];

function renderToDom(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(element);
    });
    const handle = {
        container,
        rerender(el) {
            act(() => root.render(el));
        },
        cleanup() {
            act(() => root.unmount());
            container.remove();
        },
    };
    mounted.push(handle);
    return handle;
}

async function tick(ms = 10) {
    await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
    });
}

afterEach(() => {
    for (const m of mounted) m.cleanup();
    mounted = [];
    vi.restoreAllMocks();
});

/**
 * A stub @lerret/ai: per-folder provider configs drive the AiContextProvider,
 * a tiny vision matrix backs supportsVision. f1 = openai on non-vision gpt-4;
 * f2 = openai on vision-capable gpt-4o (same provider, different model — the
 * AC-6 model-switch case).
 */
const CONFIGS_BY_FOLDER = {
    f1: [{ providerName: 'openai', active: true, model: 'gpt-4', configuredAt: '2026-06-01T00:00:00.000Z' }],
    f2: [{ providerName: 'openai', active: true, model: 'gpt-4o', configuredAt: '2026-06-02T00:00:00.000Z' }],
};

function makeAi() {
    return {
        vault: {
            listProviderConfigs: async ({ folderId }) => CONFIGS_BY_FOLDER[folderId] ?? [],
            isDisclosureAcked: async () => true,
        },
        vision: {
            supportsVision: (provider, model) => provider === 'openai' && model === 'gpt-4o',
        },
    };
}

beforeEach(() => {
    aiMock.current = makeAi();
});

function mount(folderId) {
    return renderToDom(
        <AiContextProvider folderId={folderId}>
            <VisionAttachButton onAttach={() => {}} />
        </AiContextProvider>,
    );
}

// ── Disabled-with-reason ──────────────────────────────────────────────────────

describe('VisionAttachButton — disabled-with-reason (AC-5)', () => {
    it('renders disabled with the verbatim tooltip when the active model lacks vision', async () => {
        const { container } = mount('f1'); // openai / gpt-4 (non-vision)
        await tick();
        const btn = container.querySelector('[data-testid="vision-attach-button"]');
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute('title')).toBe(
            "Active model can't see images. Configure a cloud provider in settings to enable vision.",
        );
        // The reason is also exposed for AT via aria-describedby.
        const reason = document.getElementById(btn.getAttribute('aria-describedby'));
        expect(reason.textContent).toBe(VISION_ATTACH_DISABLED_TOOLTIP);
    });

    it('renders enabled (no reason tooltip) when the active model is vision-capable', async () => {
        const { container } = mount('f2'); // openai / gpt-4o (vision)
        await tick();
        const btn = container.querySelector('[data-testid="vision-attach-button"]');
        expect(btn.disabled).toBe(false);
        expect(btn.getAttribute('title')).toBe('Attach image');
        expect(container.querySelector('[data-testid="vision-attach-reason"]')).toBeNull();
    });

    it('stays disabled (fail-closed) when @lerret/ai is absent', async () => {
        aiMock.current = null;
        const { container } = mount('f2');
        await tick();
        const btn = container.querySelector('[data-testid="vision-attach-button"]');
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute('title')).toBe(VISION_ATTACH_DISABLED_TOOLTIP);
    });
});

// ── Reactivity (AC-6) ─────────────────────────────────────────────────────────

describe('VisionAttachButton — reactive re-evaluation (AC-6)', () => {
    it('re-enables without remount when the active provider context switches to a vision-capable model', async () => {
        const view = renderToDom(
            <AiContextProvider folderId="f1">
                <VisionAttachButton onAttach={() => {}} />
            </AiContextProvider>,
        );
        await tick();
        const btnBefore = view.container.querySelector('[data-testid="vision-attach-button"]');
        expect(btnBefore.disabled).toBe(true);

        // The provider switch: the context value changes (new active model);
        // the SAME mounted button re-evaluates — no remount.
        view.rerender(
            <AiContextProvider folderId="f2">
                <VisionAttachButton onAttach={() => {}} />
            </AiContextProvider>,
        );
        await tick();
        const btnAfter = view.container.querySelector('[data-testid="vision-attach-button"]');
        expect(btnAfter).toBe(btnBefore); // same DOM node — reactive, not remounted
        expect(btnAfter.disabled).toBe(false);

        // And back: switching to the non-vision model re-disables.
        view.rerender(
            <AiContextProvider folderId="f1">
                <VisionAttachButton onAttach={() => {}} />
            </AiContextProvider>,
        );
        await tick();
        expect(btnAfter.disabled).toBe(true);
        expect(btnAfter.getAttribute('title')).toBe(VISION_ATTACH_DISABLED_TOOLTIP);
    });
});

// ── Attachment reporting ──────────────────────────────────────────────────────

/**
 * Build a picked File with KNOWN bytes. jsdom's File may lack arrayBuffer —
 * stub it on the instance when absent so the component's encode path
 * (`await f.arrayBuffer()`) reads exactly these bytes.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {string} type
 * @returns {File}
 */
function makePickedFile(bytes, name, type) {
    const file = new File([bytes], name, { type });
    if (typeof file.arrayBuffer !== 'function') {
        Object.defineProperty(file, 'arrayBuffer', {
            value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        });
    }
    return file;
}

function pickFiles(container, files) {
    const input = container.querySelector('[data-testid="vision-attach-input"]');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    act(() => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('VisionAttachButton — attachment reporting', () => {
    // PNG magic bytes — base64 'iVBORw==' is the user-verifiable expectation
    // (every base64 PNG starts iVBORw…), pinning that the component encodes
    // the FILE BYTES, not the name or a placeholder.
    const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);

    function mountWithAttach() {
        const onAttach = vi.fn();
        const view = renderToDom(
            <AiContextProvider folderId="f2">
                <VisionAttachButton onAttach={onAttach} />
            </AiContextProvider>,
        );
        return { onAttach, container: view.container };
    }

    it('reports picked images with the bytes encoded to base64 + dataUrl (async, after encode)', async () => {
        const { onAttach, container } = mountWithAttach();
        await tick();

        const file = makePickedFile(PNG_BYTES, 'shot.png', 'image/png');
        pickFiles(container, [file]);
        // onAttach fires AFTER the async encode completes — not synchronously.
        expect(onAttach).not.toHaveBeenCalled();
        await tick();

        expect(onAttach).toHaveBeenCalledTimes(1);
        const [attachments] = onAttach.mock.calls[0];
        expect(attachments).toHaveLength(1);
        expect(attachments[0]).toMatchObject({
            kind: 'image',
            type: 'image',
            mimeType: 'image/png',
            name: 'shot.png',
            base64: 'iVBORw==',
            dataUrl: 'data:image/png;base64,iVBORw==',
        });
        expect(attachments[0].file).toBe(file);
    });

    it('preserves pick order across multiple images', async () => {
        const { onAttach, container } = mountWithAttach();
        await tick();
        pickFiles(container, [
            makePickedFile(new Uint8Array([1]), 'a.png', 'image/png'),
            makePickedFile(new Uint8Array([2]), 'b.webp', 'image/webp'),
        ]);
        await tick();
        expect(onAttach).toHaveBeenCalledTimes(1);
        const [attachments] = onAttach.mock.calls[0];
        expect(attachments.map((a) => a.name)).toEqual(['a.png', 'b.webp']);
        expect(attachments.map((a) => a.base64)).toEqual(['AQ==', 'Ag==']);
        expect(attachments[1].dataUrl).toBe('data:image/webp;base64,Ag==');
    });

    it('skips non-image files — a mixed pick attaches only the image', async () => {
        const { onAttach, container } = mountWithAttach();
        await tick();
        pickFiles(container, [
            makePickedFile(new Uint8Array([104, 105]), 'notes.txt', 'text/plain'),
            makePickedFile(PNG_BYTES, 'shot.png', 'image/png'),
        ]);
        await tick();
        expect(onAttach).toHaveBeenCalledTimes(1);
        const [attachments] = onAttach.mock.calls[0];
        expect(attachments).toHaveLength(1);
        expect(attachments[0].name).toBe('shot.png');
    });

    it('never calls onAttach when ALL picked files are non-images', async () => {
        const { onAttach, container } = mountWithAttach();
        await tick();
        pickFiles(container, [makePickedFile(new Uint8Array([104]), 'notes.txt', 'text/plain')]);
        await tick(20);
        expect(onAttach).not.toHaveBeenCalled();
    });
});
