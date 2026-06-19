// Tests for the staged-image attachment preview strip (dock AI input). jsdom.
//
// Coverage:
//   - empty / non-array attachments → renders nothing,
//   - N attachments → N thumbnails carrying the dataUrl src + name alt,
//   - the group aria-label reflects the count (singular / plural),
//   - each remove (×) calls onRemove(index) with its own index,
//   - the remove button gets an image-specific aria-label.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { AttachmentPreview } from './attachment-preview.jsx';

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

afterEach(() => {
    for (const m of mounted) m.cleanup();
    mounted = [];
    vi.restoreAllMocks();
});

const img = (name) => ({
    kind: 'image',
    type: 'image',
    mimeType: 'image/png',
    name,
    base64: 'AAAA',
    dataUrl: `data:image/png;base64,AAAA#${name}`,
});

const strip = () => document.body.querySelector('[data-testid="attachment-preview"]');

describe('AttachmentPreview', () => {
    it('renders nothing when there are no attachments', () => {
        renderToDom(<AttachmentPreview attachments={[]} onRemove={() => {}} />);
        expect(strip()).toBeNull();
    });

    it('renders nothing for a non-array attachments prop', () => {
        renderToDom(<AttachmentPreview attachments={undefined} onRemove={() => {}} />);
        expect(strip()).toBeNull();
    });

    it('renders one thumbnail per attachment carrying the dataUrl + name', () => {
        renderToDom(
            <AttachmentPreview attachments={[img('logo.png'), img('hero.png')]} onRemove={() => {}} />,
        );
        const el = strip();
        expect(el).not.toBeNull();
        const imgs = el.querySelectorAll('img');
        expect(imgs.length).toBe(2);
        expect(imgs[0].getAttribute('src')).toContain('logo.png');
        expect(imgs[0].getAttribute('alt')).toBe('logo.png');
        expect(el.querySelectorAll('[data-testid="attachment-remove"]').length).toBe(2);
    });

    it('labels the group with a pluralized count', () => {
        const h = renderToDom(<AttachmentPreview attachments={[img('a.png')]} onRemove={() => {}} />);
        expect(strip().getAttribute('aria-label')).toBe('1 attached image');
        h.rerender(<AttachmentPreview attachments={[img('a.png'), img('b.png')]} onRemove={() => {}} />);
        expect(strip().getAttribute('aria-label')).toBe('2 attached images');
    });

    it('calls onRemove with the clicked index', () => {
        const onRemove = vi.fn();
        renderToDom(
            <AttachmentPreview
                attachments={[img('a.png'), img('b.png'), img('c.png')]}
                onRemove={onRemove}
            />,
        );
        const removes = document.body.querySelectorAll('[data-testid="attachment-remove"]');
        act(() => {
            removes[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onRemove).toHaveBeenCalledWith(1);
    });

    it('gives each remove button an image-specific aria-label', () => {
        renderToDom(<AttachmentPreview attachments={[img('brand-logo.png')]} onRemove={() => {}} />);
        const btn = document.body.querySelector('[data-testid="attachment-remove"]');
        expect(btn.getAttribute('aria-label')).toBe('Remove brand-logo.png');
    });
});
