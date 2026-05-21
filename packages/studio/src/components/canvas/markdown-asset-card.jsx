// markdown-asset-card.jsx — the Markdown asset card (, UX-DR11).
//
// A `.md` asset is not a fixed-dimension component artboard — it is a
// *document*. This component renders a `.md` file's raw Markdown text as a
// rich preview (headings, lists, emphasis, links, code, blockquotes, tables —
// FR9) inside an auto-height "document card" that is deliberately distinct
// from the component artboards around it:
//
// - a paper surface with a soft border + page-edge accent stripe, where a
// component artboard is a plain white framed card;
// - a small "Markdown" eyebrow so the card reads as a document at a glance;
// - auto height — the card grows with its content instead of being clipped
// to a declared width × height.
//
// It is built entirely from the studio's `--lm-*` design tokens (loaded
// globally by `main.jsx` via `styles.css`), so it matches the studio aesthetic
// and follows the theme. An **empty** `.md` file renders as an empty document
// card — a calm "empty document" placeholder, never an error (a AC).
//
// Markdown is parsed by `react-markdown` (CommonMark via remark). Only the
// inline/standard CommonMark feature set is enabled — no `rehype-raw`, so raw
// HTML embedded in the `.md` is shown as text, not executed. That keeps a
// `.md` asset a safe document preview.

import React from 'react';
import ReactMarkdown from 'react-markdown';

// ---------------------------------------------------------------------------
// Scoped element styles
// ---------------------------------------------------------------------------
//
// `react-markdown` renders plain HTML tags; the studio is inline-style-heavy
// and these need to read consistently whatever theme/scope they mount in. We
// inject one scoped stylesheet (class-prefixed so it cannot collide) that
// styles every Markdown element from the `--lm-*` tokens. Injected once.

const MD_STYLE_ID = 'lerret-md-card-styles';

function ensureMarkdownCardStyles() {
 if (typeof document === 'undefined') return;
 if (document.getElementById(MD_STYLE_ID)) return;
 const style = document.createElement('style');
 style.id = MD_STYLE_ID;
 style.textContent = `
.lm-md-card{
 box-sizing:border-box;
 width:100%;
 background:var(--lm-bg-primary,#FAF8F2);
 border:1px solid var(--lm-border,#DDD7CA);
 border-left:3px solid var(--lm-accent,#B85B33);
 border-radius:var(--lm-radius-lg,12px);
 box-shadow:var(--lm-shadow-sm,0 1px 3px rgba(26,23,20,.10));
 font-family:var(--lm-font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
 color:var(--lm-text-secondary,#3A3530);
 overflow:hidden;
}
.lm-md-card__eyebrow{
 display:flex;align-items:center;gap:var(--lm-space-2,8px);
 padding:var(--lm-space-3,12px) var(--lm-space-5,20px);
 border-bottom:1px solid var(--lm-border-light,#E8E2D4);
 background:var(--lm-bg-secondary,#F2EEE6);
 font:var(--lm-weight-semibold,600) var(--lm-size-hint,10px)/1 var(--lm-font-sans,sans-serif);
 letter-spacing:var(--lm-tracking-caps,0.5px);
 text-transform:uppercase;
 color:var(--lm-text-tertiary,#6E6960);
}
.lm-md-card__eyebrow svg{flex:none;color:var(--lm-accent,#B85B33);}
.lm-md-card__body{
 padding:var(--lm-space-5,20px) var(--lm-space-6,24px) var(--lm-space-6,24px);
 font-size:var(--lm-size-body,13px);
 line-height:var(--lm-lh-relaxed,1.6);
}
/* The rendered document — every node token-styled. */
.lm-md-doc>*:first-child{margin-top:0;}
.lm-md-doc>*:last-child{margin-bottom:0;}
.lm-md-doc h1,.lm-md-doc h2,.lm-md-doc h3,
.lm-md-doc h4,.lm-md-doc h5,.lm-md-doc h6{
 color:var(--lm-text-primary,#1A1714);
 font-family:var(--lm-font-sans,sans-serif);
 font-weight:var(--lm-weight-semibold,600);
 line-height:var(--lm-lh-tight,1.2);
 letter-spacing:-0.01em;
 margin:var(--lm-space-5,20px) 0 var(--lm-space-3,12px);
}
.lm-md-doc h1{font-size:var(--lm-size-h1,24px);}
.lm-md-doc h2{font-size:var(--lm-size-h2,20px);}
.lm-md-doc h3{font-size:var(--lm-size-h3,16px);}
.lm-md-doc h4,.lm-md-doc h5,.lm-md-doc h6{font-size:var(--lm-size-header,15px);}
.lm-md-doc h1{
 padding-bottom:var(--lm-space-2,8px);
 border-bottom:1px solid var(--lm-border-light,#E8E2D4);
}
.lm-md-doc p{margin:var(--lm-space-3,12px) 0;}
.lm-md-doc a{
 color:var(--lm-accent,#B85B33);
 text-decoration:underline;
 text-underline-offset:2px;
}
.lm-md-doc a:hover{color:var(--lm-accent-hover,#92421E);}
.lm-md-doc strong{color:var(--lm-text-primary,#1A1714);font-weight:var(--lm-weight-semibold,600);}
.lm-md-doc em{font-style:italic;}
.lm-md-doc ul,.lm-md-doc ol{margin:var(--lm-space-3,12px) 0;padding-left:var(--lm-space-6,24px);}
.lm-md-doc li{margin:var(--lm-space-1,4px) 0;}
.lm-md-doc li::marker{color:var(--lm-text-tertiary,#6E6960);}
.lm-md-doc code{
 font-family:var(--lm-font-mono,"Geist Mono",monospace);
 font-size:0.92em;
 background:var(--lm-bg-tertiary,#E8E2D4);
 color:var(--lm-text-primary,#1A1714);
 padding:2px 6px;
 border-radius:var(--lm-radius-xs,4px);
}
.lm-md-doc pre{
 margin:var(--lm-space-4,16px) 0;
 padding:var(--lm-space-4,16px);
 background:var(--lm-bg-tertiary,#E8E2D4);
 border:1px solid var(--lm-border,#DDD7CA);
 border-radius:var(--lm-radius-md,8px);
 overflow:auto;
}
.lm-md-doc pre code{
 display:block;
 background:none;
 padding:0;
 font-size:var(--lm-size-body-sm,12px);
 line-height:var(--lm-lh-body,1.45);
 color:var(--lm-text-secondary,#3A3530);
}
.lm-md-doc blockquote{
 margin:var(--lm-space-4,16px) 0;
 padding:var(--lm-space-1,4px) var(--lm-space-4,16px);
 border-left:3px solid var(--lm-accent-border,rgba(184,91,51,.20));
 color:var(--lm-text-tertiary,#6E6960);
 font-style:italic;
}
.lm-md-doc hr{
 margin:var(--lm-space-5,20px) 0;
 border:none;
 border-top:1px solid var(--lm-border,#DDD7CA);
}
.lm-md-doc img{max-width:100%;border-radius:var(--lm-radius-sm,6px);}
.lm-md-doc table{
 border-collapse:collapse;
 margin:var(--lm-space-4,16px) 0;
 font-size:var(--lm-size-body-sm,12px);
}
.lm-md-doc th,.lm-md-doc td{
 border:1px solid var(--lm-border,#DDD7CA);
 padding:var(--lm-space-2,8px) var(--lm-space-3,12px);
 text-align:left;
}
.lm-md-doc th{background:var(--lm-bg-secondary,#F2EEE6);color:var(--lm-text-primary,#1A1714);}
.lm-md-card__empty{
 color:var(--lm-text-muted,#B8B3A8);
 font-size:var(--lm-size-body-sm,12px);
 font-style:italic;
}
`;
 document.head.appendChild(style);
}

// A small document glyph for the card eyebrow.
function MarkdownGlyph() {
 return (
 <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden="true">
 <path
 d="M1.5 1.5h5L9.5 4.5v7H1.5z"
 stroke="currentColor"
 strokeWidth="1.2"
 strokeLinejoin="round"
 />
 <path d="M6.3 1.6v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
 </svg>
 );
}

/**
 * The Markdown asset card — renders one `.md` asset's text as a rich-preview
 * document card on the canvas (, UX-DR11).
 *
 * Auto-height by design: the card has no fixed height, so it grows to fit its
 * content. Width is governed by its container (the canvas places it inside an
 * artboard slot with a fixed width). The host artboard wrapper must let the
 * card's height be `auto` for the document-card behavior to show.
 *
 * An empty / whitespace-only `text` renders the empty-document state — never an
 * error (a acceptance criterion).
 *
 * @param {object} props
 * @param {string} [props.text] The `.md` file's raw Markdown source.
 * @returns {React.ReactElement}
 */
export function MarkdownAssetCard({ text }) {
 // Inject the scoped element styles on first render (idempotent).
 React.useEffect(() => {
 ensureMarkdownCardStyles();
 }, []);
 // Also inject synchronously so the very first paint is styled (the effect
 // above only covers re-renders / SSR-less mounts after paint).
 ensureMarkdownCardStyles();

 const source = typeof text === 'string' ? text : '';
 const isEmpty = source.trim().length === 0;

 return (
 <div className="lm-md-card" data-asset-kind="markdown">
 <div className="lm-md-card__eyebrow">
 <MarkdownGlyph />
 <span>Markdown</span>
 </div>
 <div className="lm-md-card__body">
 {isEmpty ? (
 <div className="lm-md-card__empty">Empty document</div>
 ) : (
 <div className="lm-md-doc">
 <ReactMarkdown>{source}</ReactMarkdown>
 </div>
 )}
 </div>
 </div>
 );
}

export default MarkdownAssetCard;
