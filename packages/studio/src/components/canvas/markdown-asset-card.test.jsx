// Tests for the Markdown asset card (`markdown-asset-card.jsx`, ).
//
// The card parses a `.md` asset's raw Markdown and renders it as a rich
// document-card preview. These tests assert the FR9 feature set — headings,
// lists, emphasis, links, code (inline + fenced) — actually renders, and that
// an empty `.md` renders the empty-document state with no error.
//
// Rendering uses `react-dom/client` into a detached jsdom container — the same
// dependency-free pattern as `vite-runtime.test.js`.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from 'vitest';

import { MarkdownAssetCard } from './markdown-asset-card.jsx';

/** Mount an element into a detached jsdom container; returns it + a teardown. */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 return {
 container,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

describe('MarkdownAssetCard', () => {
 it('renders as a document card with a quiet "md" tag (no filled header bar)', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(MarkdownAssetCard, { text: '# Doc' }),
 );
 const card = container.querySelector('[data-asset-kind="markdown"]');
 expect(card).toBeTruthy();
 expect(card.className).toContain('lm-md-card');
 // The minimal redesign drops the filled eyebrow bar for one low-contrast tag.
 const tag = container.querySelector('.lm-md-card__tag');
 expect(tag).toBeTruthy();
 expect(tag.textContent).toMatch(/md/i);
 expect(container.querySelector('.lm-md-card__eyebrow')).toBeNull();
 cleanup();
 });

 it('renders the rich-preview feature set — headings, lists, emphasis, links, code (FR9)', () => {
 const md = [
 '# Heading one',
 '## Heading two',
 '',
 'A paragraph with **bold**, *italic*, and `inline code`.',
 '',
 '- first bullet',
 '- second bullet',
 '',
 '1. ordered one',
 '2. ordered two',
 '',
 '[a link](https://lerret.belikely.com)',
 '',
 '```js',
 'const x = 1;',
 '```',
 '',
 '> a blockquote',
 ].join('\n');

 const { container, cleanup } = renderToDom(
 React.createElement(MarkdownAssetCard, { text: md }),
 );

 // Headings
 expect(container.querySelector('h1').textContent).toBe('Heading one');
 expect(container.querySelector('h2').textContent).toBe('Heading two');
 // Emphasis
 expect(container.querySelector('strong').textContent).toBe('bold');
 expect(container.querySelector('em').textContent).toBe('italic');
 // Lists — one unordered, one ordered
 expect(container.querySelector('ul')).toBeTruthy();
 expect(container.querySelector('ol')).toBeTruthy();
 expect(container.querySelectorAll('li').length).toBe(4);
 // Link — href preserved
 const link = container.querySelector('a');
 expect(link.getAttribute('href')).toBe('https://lerret.belikely.com');
 // Code — a fenced block (pre>code) and inline code
 expect(container.querySelector('pre code')).toBeTruthy();
 expect(container.querySelector('pre code').textContent).toContain('const x = 1;');
 expect(container.querySelector(':not(pre) > code')).toBeTruthy();
 // Blockquote
 expect(container.querySelector('blockquote')).toBeTruthy();

 cleanup();
 });

 it('renders an empty .md as an empty document card with no error', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(MarkdownAssetCard, { text: '' }),
 );
 // The card frame still renders ...
 expect(container.querySelector('[data-asset-kind="markdown"]')).toBeTruthy();
 // ... with the empty-document placeholder, and no document content.
 expect(container.textContent).toMatch(/empty document/i);
 expect(container.querySelector('h1')).toBeNull();
 expect(container.querySelector('p')).toBeNull();
 cleanup();
 });

 it('treats whitespace-only and missing text as an empty document', () => {
 for (const text of [' \n \t ', undefined]) {
 const { container, cleanup } = renderToDom(
 React.createElement(MarkdownAssetCard, { text }),
 );
 expect(container.textContent).toMatch(/empty document/i);
 cleanup();
 }
 });

 it('does not execute raw HTML embedded in the markdown', () => {
 // No `rehype-raw` — embedded HTML is shown as text, never mounted. The
 // `.md` asset stays a safe document preview.
 const { container, cleanup } = renderToDom(
 React.createElement(MarkdownAssetCard, {
 text: 'Before <button data-injected="1">hi</button> after',
 }),
 );
 expect(container.querySelector('button[data-injected]')).toBeNull();
 cleanup();
 });
});
