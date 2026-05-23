// walkthrough-steps.js
// Extended step sequence introducing the folder→canvas model.
//
// Extracted from studio-shell.jsx (the original sequence was dock-centric).
// This file defines the new 8-step sequence that teaches the folder→canvas
// paradigm, the page picker, artboards, the kebab menu, editors, export, and
// a closing "done" slide pointing to docs.
//
// Spotlight target selectors use `data-tour="..."` attributes on real DOM
// elements. The `target: null` steps (steps 1, 3, 6) show a full-screen dim
// and an anchored card (page-picker uses data-tour="dock-pages"; artboard step
// uses .lm-artboard-kebab-host; kebab step uses [data-testid="lm-artboard-kebab"]).

/**
 * @typedef {object} WalkthroughStep
 * @property {string|null} target CSS selector for the spotlight element,
 * or null for a full-screen overlay step.
 * @property {string} title Card heading.
 * @property {string} [body] Card body text.
 * @property {boolean} [isProTip] Whether to render as the pro-tip card.
 * @property {boolean} [isDone] Whether to render as the closing "Done" card.
 * @property {string} [singlePageBody] Alternate body when only one project page is present.
 */

/** @type {WalkthroughStep[]} */
export const WALKTHROUGH_STEPS = [
 // 1 — Welcome
 {
 target: '[data-tour="canvas"]',
 title: 'Welcome to your Lerret studio.',
 body: 'Your designs live as plain files — React components, Markdown docs, images — in a folder on your machine. Lerret reads that folder and renders it here as a live canvas.',
 },

 // 2 — Folder → canvas mapping
 {
 target: '[data-tour="canvas"]',
 title: 'Folders become pages, files become artboards.',
 body: 'Each sub-folder inside your .lerret/ directory is a page. Nested folders inside a page become groups. Every .jsx/.tsx/.md file inside a group becomes an artboard on that page. No config required.',
 },

 // 3 — Page picker
 {
 target: '[data-tour="dock-pages"]',
 title: 'Switch between pages here.',
 body: 'The page picker in the dock shows your current page. With more than one page, click or use arrow keys to switch. With a single page it shows a static label.',
 singlePageBody: 'Your project has one page — its name appears here as a static label. Add more sub-folders to your .lerret/ directory and they become additional pages.',
 },

 // 4 — Artboards
 {
 target: '[data-tour="section"]',
 title: 'Each file is an artboard.',
 body: 'A .jsx or .tsx component file becomes a sized artboard rendered with its live data. A .md file becomes an auto-height document card. Both update in real time when you save the file.',
 },

 // 5 — Kebab menu
 {
 target: '.lm-artboard-kebab',
 title: 'The ⋮ menu surfaces lifecycle actions.',
 body: 'Hover (or focus) an artboard to reveal its kebab menu. From there: edit data, edit meta, duplicate, rename, delete, export as PNG, or reveal the file in your editor.',
 },

 // 6 — Summoned editors (no widget to point at; use canvas as anchor)
 {
 target: '[data-tour="canvas"]',
 title: 'Component code lives in your editor — data lives here.',
 body: 'Edit .jsx/.tsx source in your code editor or AI tool; Lerret hot-reloads it automatically. For data (.data.json), config (config.json), meta (the meta export), and Markdown content, use the in-studio forms via the kebab menu — no file editing needed.',
 },

 // 7 — Export
 {
 target: '[data-tour="dock-brand"]',
 title: 'Export from the Lerret menu.',
 body: 'Open the Lerret menu → Export project to download every artboard across all pages as one structured ZIP (choose PNG or JPG). To export a single page or group, use its ⋯ Actions menu; a single artboard exports from its hover kebab — and "Export animated…" turns a LiveRefresh artboard into WebP, GIF, APNG, or MP4.',
 },

 // 8 — Done / docs
 {
 target: null,
 title: 'You\'re all set.',
 isDone: true,
 },
];
