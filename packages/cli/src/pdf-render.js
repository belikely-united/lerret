// pdf-render.js — render one Markdown asset to a TRUE-VECTOR PDF via headless
// Chromium, on demand for the studio's per-card "PDF" button.
//
// Flow: launch a headless Chromium (system Chrome first; same launcher the
// export pipeline uses), point it at the RUNNING dev server's `?lerretPdf=
// <assetPath>` render mode (pdf-doc-view.jsx renders just the document — no
// card border/chrome), wait for it to signal it has painted, then call
// `page.pdf()`. Chromium turns the live DOM into vector PDF: selectable text,
// sharp at any zoom. The returned Buffer is streamed back to the browser by the
// `/__lerret/export-pdf` endpoint.

import { launchHeadlessBrowser } from './browser-launch.js';

/**
 * Render the Markdown asset at `assetPath` to a one-page-or-more vector PDF.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl  Origin of the running dev server, e.g.
 *   `http://127.0.0.1:5173` — the headless page navigates here.
 * @param {string} opts.assetPath  The asset's {@link LerretPath} (full path).
 * @param {number} [opts.timeoutMs=25000]  Per-step navigation / render ceiling.
 * @returns {Promise<Buffer>}  The PDF bytes.
 */
export async function renderAssetPdf({ baseUrl, assetPath, timeoutMs = 25000 }) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('renderAssetPdf: baseUrl is required');
  }
  if (typeof assetPath !== 'string' || assetPath.length === 0) {
    throw new Error('renderAssetPdf: assetPath is required');
  }

  const { browser } = await launchHeadlessBrowser();
  try {
    const page = await browser.newPage();
    const url = `${baseUrl.replace(/\/+$/, '')}/?lerretPdf=${encodeURIComponent(assetPath)}`;
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    // pdf-doc-view sets this once the document has painted.
    /* eslint-disable no-undef */
    await page.waitForFunction(() => window.__lerret_pdf_ready === true, null, {
      timeout: timeoutMs,
    });
    /* eslint-enable no-undef */
    const buffer = await page.pdf({
      printBackground: true,
      format: 'A4',
      margin: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
    });
    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}
