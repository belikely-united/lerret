// pdf-doc-view.jsx — the headless PDF render mode for a Markdown asset.
//
// When the studio is loaded with `?lerretPdf=<assetPath>` (only ever done by
// the CLI's `/__lerret/export-pdf` endpoint driving a headless Chromium), we
// skip the whole studio and render JUST the asset's document — the same
// `.lm-md-doc` rendering and CSS the on-canvas Markdown card uses, but with no
// card border, header, or chrome. Chromium's `page.pdf()` then turns this DOM
// into a true vector PDF (selectable, sharp at any zoom).
//
// The doc is read through the exact same `defaultReadAssetSource` the meta
// editor / size chip use, so it stays in lock-step with how the studio reads a
// file. Once the document has painted we set `window.__lerret_pdf_ready` — the
// signal the endpoint waits on before calling `page.pdf()`.

import React from 'react';
import ReactMarkdown from 'react-markdown';

import { ensureMarkdownCardStyles } from './components/canvas/markdown-asset-card.jsx';
import { defaultReadAssetSource } from './components/editors/meta-editor.jsx';

const PDF_VIEW_STYLE_ID = 'lerret-pdf-doc-styles';

// A print-friendly wrapper around the shared `.lm-md-doc` rules: white page,
// readable measure, generous margin. `page.pdf()` adds the paper margins; this
// just makes the document itself read like a clean page.
function ensurePdfDocStyles() {
 if (typeof document === 'undefined') return;
 if (document.getElementById(PDF_VIEW_STYLE_ID)) return;
 const style = document.createElement('style');
 style.id = PDF_VIEW_STYLE_ID;
 style.textContent = `
html,body{background:#fff;margin:0;padding:0;}
.lm-pdf-doc{
 box-sizing:border-box;
 background:#fff;
 color:var(--lm-text-secondary,#3A3530);
 font-family:var(--lm-font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
 font-size:var(--lm-size-body,13px);
 line-height:var(--lm-lh-relaxed,1.6);
 padding:8px 4px;
}
.lm-pdf-doc .lm-md-card__empty{
 color:var(--lm-text-muted,#B8B3A8);
 font-style:italic;
}
`;
 document.head.appendChild(style);
}

/**
 * Render one Markdown asset's document, bare, for headless PDF capture.
 *
 * @param {object} props
 * @param {string} props.assetPath The asset's {@link LerretPath} (full path).
 * @returns {React.ReactElement}
 */
export function PdfDocView({ assetPath }) {
 ensureMarkdownCardStyles();
 ensurePdfDocStyles();

 const [state, setState] = React.useState({ status: 'loading' });

 React.useEffect(() => {
 let cancelled = false;
 defaultReadAssetSource(assetPath).then((r) => {
 if (cancelled) return;
 setState(
 r.ok ? { status: 'ready', source: r.source || '' } : { status: 'error', error: r.error },
 );
 });
 return () => {
 cancelled = true;
 };
 }, [assetPath]);

 // Signal the headless renderer once the document has actually painted. Two
 // rAFs ensure layout + paint have flushed before `page.pdf()` runs.
 React.useEffect(() => {
 if (state.status === 'loading') return undefined;
 const id = requestAnimationFrame(() =>
 requestAnimationFrame(() => {
 if (typeof window !== 'undefined') window.__lerret_pdf_ready = true;
 }),
 );
 return () => cancelAnimationFrame(id);
 }, [state.status]);

 const source = state.status === 'ready' ? state.source : '';
 const isEmpty = source.trim().length === 0;

 return (
 <div className="lm-pdf-doc" data-lerret-pdf-doc="true">
 {isEmpty ? (
 <div className="lm-md-card__empty">Empty document</div>
 ) : (
 <div className="lm-md-doc">
 <ReactMarkdown>{source}</ReactMarkdown>
 </div>
 )}
 </div>
 );
}

export default PdfDocView;
