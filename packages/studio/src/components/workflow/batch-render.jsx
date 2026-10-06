// batch-render.jsx — render one design many times, off-screen, and capture it.
//
// Each render mounts the design's component in a hidden, full-size container
// (fresh React root per row, so earlier text swaps never leak), applies the
// row's text replacements to the rendered text, waits for images + fonts, and
// captures it with the same `captureArtboard` the exports use.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { resolveProps, resolveVariantData } from '@lerret/core';

import { captureArtboard } from '../../export/capture.js';
import { AssetErrorBoundary } from '../../runtime/asset-runtime.js';

/**
 * The props a design renders with on the canvas: its data file (variant-aware)
 * resolved against its propsSchema — the same resolution the artboard uses.
 *
 * @param {object} entry      A runtime component entry.
 * @param {unknown} dataValue The parsed data file (or undefined).
 * @returns {Record<string, unknown>}
 */
export function baseProps(entry, dataValue) {
  const variantName = entry?.variantName || 'default';
  const names = Array.isArray(entry?.variantNames) && entry.variantNames.length ? entry.variantNames : [variantName];
  const data = dataValue && typeof dataValue === 'object' ? { source: 'json', value: dataValue } : { source: 'absent' };
  const record = resolveVariantData(data, names, { assetPath: entry?.asset?.path }).get(variantName);
  return resolveProps({ data: record && record.source !== 'absent' ? record.value : undefined, propsSchema: entry?.meta?.propsSchema });
}

/** The design's size, from its meta (falls back to 800×450). */
export function designSize(entry) {
  const d = entry?.meta?.dimensions;
  return {
    width: Number(d?.width) > 0 ? Number(d.width) : 800,
    height: Number(d?.height) > 0 ? Number(d.height) : 450,
  };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Replace whole text nodes equal to a mapped text (`'John Doe'` → the row's
 * value), keeping the node's surrounding whitespace.
 *
 * @param {Node} root
 * @param {Array<[string, string]>} replacements
 * @returns {number} How many text nodes changed.
 */
export function replaceTexts(root, replacements) {
  if (!replacements.length) return 0;
  const wanted = new Map(replacements.map(([from, to]) => [from.trim(), to]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let changed = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const key = n.nodeValue.trim();
    if (wanted.has(key)) {
      n.nodeValue = n.nodeValue.replace(key, wanted.get(key));
      changed += 1;
    }
  }
  return changed;
}

/** Leaf texts shown on a rendered design, in order, de-duplicated. */
export function visibleTexts(root) {
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (t && t.length <= 120 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Mount a design off-screen and run `work(container)` once it has painted.
 *
 * @param {{ entry: object, props: object, varsStyle?: object | null }} design
 * @param {(container: HTMLElement) => Promise<T>} work
 * @returns {Promise<T>}
 * @template T
 */
export async function withRenderedDesign({ entry, props, varsStyle }, work) {
  const { width, height } = designSize(entry);
  const host = document.createElement('div');
  host.setAttribute('data-lm-batch', '');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'hidden',
    pointerEvents: 'none',
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  let failed = null;
  const Component = entry.Component;
  try {
    // Commit synchronously: the text swap below must see the rendered DOM,
    // never race a render that is still scheduled.
    flushSync(() => root.render(
      <div style={{ ...(varsStyle || {}), position: 'relative', width: '100%', height: '100%' }}>
        <AssetErrorBoundary onError={(err) => { failed = err; }} resetKey="batch">
          <Component {...props} />
        </AssetErrorBoundary>
      </div>,
    ));
    await nextFrame();
    if (failed) throw new Error(failed.message || 'The design failed to render.');
    return await work(host);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Wait for every image in `root` to load (or fail) and for fonts. */
async function settled(root) {
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) =>
      img.complete ? null : new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }),
    ),
  );
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  await nextFrame();
}

/**
 * Render a design with one row's text swapped in and capture it.
 *
 * @param {{ entry: object, props: object, varsStyle?: object | null }} design
 * @param {Array<[string, string]>} replacements
 * @param {{ format: 'png' | 'jpg', pixelRatio?: number, capture?: typeof captureArtboard }} opts
 * @returns {Promise<Blob>}
 */
export function renderRow(design, replacements, { format, pixelRatio = 2, capture = captureArtboard }) {
  return withRenderedDesign(design, async (host) => {
    // Swap every mapped text; if one isn't on screen yet (a design that
    // renders in stages), wait a frame and try again — never capture the
    // placeholder by mistake.
    const pending = new Map(replacements.map(([from, to]) => [from.trim(), to]));
    for (let tries = 0; pending.size && tries < 20; tries += 1) {
      for (const [from, to] of [...pending]) {
        if (replaceTexts(host, [[from, to]]) > 0 || !from) pending.delete(from);
      }
      if (pending.size) await nextFrame();
    }
    if (pending.size) {
      throw new Error(`Couldn’t find “${[...pending.keys()][0]}” on the design to replace.`);
    }
    await settled(host);
    // Capture the design's own wrapper, not the off-screen host (whose fixed,
    // far-off position must not leak into the captured clone).
    const { blob } = await capture(host.firstElementChild || host, {
      format,
      pixelRatio,
      quality: 0.92,
      ...(format === 'jpg' ? { backgroundColor: '#ffffff' } : {}),
    });
    return blob;
  });
}
