// image-drop.test.js — naming, sizing and placement for dropped images.

import { afterEach, describe, expect, it } from 'vitest';

import {
  isImageFile,
  dragHasFiles,
  splitImageName,
  uniqueBase,
  artboardSizeFor,
  insertBoxFor,
  FALLBACK_IMAGE_SIZE,
} from './image-drop.js';
import { resolveDropTarget } from './image-drop-layer.jsx';

describe('isImageFile / dragHasFiles', () => {
  it('accepts images by MIME type or extension, nothing else', () => {
    expect(isImageFile({ name: 'a.bin', type: 'image/png' })).toBe(true);
    expect(isImageFile({ name: 'Logo.SVG', type: '' })).toBe(true);
    expect(isImageFile({ name: 'notes.pdf', type: 'application/pdf' })).toBe(false);
    expect(isImageFile(null)).toBe(false);
  });

  it('detects a file drag from its types', () => {
    expect(dragHasFiles({ types: ['Files'] })).toBe(true);
    expect(dragHasFiles({ types: ['text/plain'] })).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});

describe('splitImageName', () => {
  it('cleans the base name and normalizes the extension', () => {
    expect(splitImageName('My Logo (final).PNG')).toEqual({ base: 'My Logo final', ext: 'png' });
    expect(splitImageName('photo.jpeg')).toEqual({ base: 'photo', ext: 'jpg' });
  });

  it('falls back to "image" for an unusable name', () => {
    expect(splitImageName('???.png').base).toBe('image');
  });
});

describe('uniqueBase', () => {
  it('skips names whose paths exist or are already claimed by this drop', async () => {
    const taken = new Set(['/p/logo.jsx', '/p/logo-2.png']);
    const exists = async (p) => taken.has(p);
    const pathsFor = (c) => [`/p/${c}.jsx`, `/p/${c}.png`];
    expect(await uniqueBase('logo', pathsFor, exists)).toBe('logo-3');
    expect(await uniqueBase('icon', pathsFor, exists, new Set(['icon']))).toBe('icon-2');
  });
});

describe('artboardSizeFor', () => {
  it('keeps a normal size, scales a huge one down, and handles 0×0', () => {
    expect(artboardSizeFor(1024, 500)).toEqual({ width: 1024, height: 500 });
    expect(artboardSizeFor(20000, 10000)).toEqual({ width: 10000, height: 5000 });
    expect(artboardSizeFor(0, 0)).toEqual(FALLBACK_IMAGE_SIZE);
    expect(artboardSizeFor(4, 4)).toEqual({ width: 16, height: 16 });
  });
});

describe('insertBoxFor', () => {
  const art = { width: 1000, height: 1000 };

  it('fits within half the artboard, centered on the drop point', () => {
    expect(insertBoxFor({ width: 2000, height: 1000 }, art, { x: 500, y: 500 })).toEqual({
      left: 250,
      top: 375,
      width: 500,
      height: 250,
    });
  });

  it('never upscales, stays inside the artboard, and cascades extra images', () => {
    expect(insertBoxFor({ width: 100, height: 100 }, art, { x: 0, y: 990 })).toEqual({
      left: 0,
      top: 900,
      width: 100,
      height: 100,
    });
    expect(insertBoxFor({ width: 100, height: 100 }, art, { x: 500, y: 500 }, 2).left).toBe(498);
  });
});

describe('resolveDropTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function canvas() {
    document.body.innerHTML = `
      <div class="design-canvas">
        <div data-dc-section="/p/.lerret/brand" data-dc-section-bare="true">
          <div data-dc-asset-path="/p/.lerret/brand/card.jsx" data-dc-label="Card"><div class="dc-card"><h1 id="h">Hi</h1></div></div>
          <div data-dc-asset-path="/p/.lerret/brand/notes.md"><div class="dc-card"><p id="md">x</p></div></div>
          <div data-dc-section="/p/.lerret/brand/social"><span id="group">g</span></div>
        </div>
        <span id="bg">bg</span>
      </div>
      <div id="dock">dock</div>`;
  }

  it('targets the artboard under the pointer for an insert', () => {
    canvas();
    const t = resolveDropTarget(document.getElementById('h'), '/p/.lerret/brand');
    expect(t).toMatchObject({ kind: 'insert', assetPath: '/p/.lerret/brand/card.jsx', label: 'Insert into Card' });
  });

  it('creates in the group or page under the pointer (markdown counts as background)', () => {
    canvas();
    expect(resolveDropTarget(document.getElementById('group'), '/p/.lerret/brand')).toMatchObject({
      kind: 'create',
      folder: '/p/.lerret/brand/social',
      label: 'Add as new asset to social',
    });
    expect(resolveDropTarget(document.getElementById('md'), '/p/.lerret/brand')).toMatchObject({
      kind: 'create',
      folder: '/p/.lerret/brand',
    });
    expect(resolveDropTarget(document.getElementById('bg'), '/p/.lerret/brand')).toMatchObject({
      kind: 'create',
      folder: '/p/.lerret/brand',
    });
  });

  it('ignores drops outside the canvas', () => {
    canvas();
    expect(resolveDropTarget(document.getElementById('dock'), '/p/.lerret/brand')).toBeNull();
  });
});
