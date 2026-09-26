// Kind glyphs for menu headers and canvas name tags — page, group, artboard,
// note. Inherit currentColor. Own module so any consumer (and test mocks of the
// menu barrel) can use them without pulling in the menus.

export const KIND_ICONS = {
 group: (
 <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
 <path d="M1.5 4.5a1 1 0 011-1h3.6l1.5 1.6h5.9a1 1 0 011 1v6.4a1 1 0 01-1 1h-11a1 1 0 01-1-1z" />
 </svg>
 ),
 page: (
 <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
 <path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" />
 </svg>
 ),
 component: (
 <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
 <rect x="2" y="3" width="12" height="10" rx="1.5" />
 </svg>
 ),
 markdown: (
 <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
 <path d="M3 4h10M3 8h10M3 12h6" />
 </svg>
 ),
};
