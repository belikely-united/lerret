// selection-preview.test.js — the selected-artboard image handed to the AI.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureSelectionPreview, findSelectedSlot, PREVIEW_MAX_EDGE } from './selection-preview.js';

function slot({ path, slotId, w, h }) {
    const el = document.createElement('div');
    el.setAttribute('data-dc-asset-path', path);
    el.setAttribute('data-dc-slot', slotId);
    el.setAttribute('data-dc-w', String(w));
    el.setAttribute('data-dc-h', String(h));
    const card = document.createElement('div');
    card.className = 'dc-card';
    el.appendChild(card);
    document.body.appendChild(el);
    return el;
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('findSelectedSlot', () => {
    it('prefers the exact clicked variant, else the first artboard of the asset', () => {
        const a = slot({ path: '/p/.lerret/s/hero.jsx', slotId: 'hero#default', w: 100, h: 100 });
        const b = slot({ path: '/p/.lerret/s/hero.jsx', slotId: 'hero#Dark', w: 100, h: 100 });
        expect(findSelectedSlot({ filePath: '/p/.lerret/s/hero.jsx', slotId: 'hero#Dark' })).toBe(b);
        expect(findSelectedSlot({ filePath: '/p/.lerret/s/hero.jsx' })).toBe(a);
        expect(findSelectedSlot({ filePath: '/p/.lerret/s/other.jsx' })).toBeNull();
    });
});

describe('captureSelectionPreview', () => {
    it('captures the card as a PNG scaled so the longest edge fits the cap', async () => {
        slot({ path: 'store/story.jsx', slotId: 'story', w: 1080, h: 1920 });
        const capture = vi.fn(async () => ({ blob: new Blob(['png'], { type: 'image/png' }) }));
        const preview = await captureSelectionPreview({ kind: 'file', filePath: 'store/story.jsx' }, { capture });
        expect(capture).toHaveBeenCalledWith(expect.any(HTMLElement), {
            format: 'png',
            pixelRatio: PREVIEW_MAX_EDGE / 1920,
        });
        expect(preview).toMatchObject({ kind: 'image', mimeType: 'image/png', base64: btoa('png') });
    });

    it('never upscales a small artboard', async () => {
        slot({ path: 'a.jsx', slotId: 'a', w: 240, h: 240 });
        const capture = vi.fn(async () => ({ blob: new Blob(['x']) }));
        await captureSelectionPreview({ kind: 'file', filePath: 'a.jsx' }, { capture });
        expect(capture.mock.calls[0][1].pixelRatio).toBe(1);
    });

    it('resolves null for no selection, a missing artboard, or a failed capture', async () => {
        const failing = vi.fn(async () => {
            throw new Error('boom');
        });
        expect(await captureSelectionPreview(null)).toBeNull();
        expect(await captureSelectionPreview({ kind: 'page', label: 'x' })).toBeNull();
        expect(await captureSelectionPreview({ kind: 'file', filePath: 'nope.jsx' }, { capture: failing })).toBeNull();
        slot({ path: 'a.jsx', slotId: 'a', w: 10, h: 10 });
        expect(await captureSelectionPreview({ kind: 'file', filePath: 'a.jsx' }, { capture: failing })).toBeNull();
    });

    it('gives up on a capture slower than the timeout', async () => {
        slot({ path: 'a.jsx', slotId: 'a', w: 10, h: 10 });
        const hanging = () => new Promise(() => {});
        const r = await captureSelectionPreview({ kind: 'file', filePath: 'a.jsx' }, { capture: hanging, timeoutMs: 10 });
        expect(r).toBeNull();
    });
});
