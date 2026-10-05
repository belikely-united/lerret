// curated-fonts.js — the typefaces the Design panel offers.
//
// A short, safe list (system + eight Google families covering clean sans,
// geometric, display and serif), loaded once by the studio so any asset that
// uses one renders — and exports, since capture inlines the document's Google
// Fonts — without the user installing anything.

import { DEFAULT_FONT_STACK } from '@lerret/core';

/** [label, CSS font-family] — the first entry is the default. */
export const CURATED_FONTS = Object.freeze([
  ['System (SF Pro)', DEFAULT_FONT_STACK],
  ['Inter', "'Inter', sans-serif"],
  ['Poppins', "'Poppins', sans-serif"],
  ['Montserrat', "'Montserrat', sans-serif"],
  ['DM Sans', "'DM Sans', sans-serif"],
  ['Space Grotesk', "'Space Grotesk', sans-serif"],
  ['Bebas Neue', "'Bebas Neue', sans-serif"],
  ['Playfair Display', "'Playfair Display', serif"],
  ['Lora', "'Lora', serif"],
]);

const FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300..900&family=Poppins:wght@300;400;500;600;700;800;900' +
  '&family=Montserrat:wght@300..900&family=DM+Sans:wght@300..900&family=Space+Grotesk:wght@300..700' +
  '&family=Bebas+Neue&family=Playfair+Display:wght@400..900&family=Lora:wght@400..700&display=swap';

/** Add the stylesheet once (fonts download lazily, only when used). */
export function loadCuratedFonts() {
  if (typeof document === 'undefined' || document.getElementById('lm-curated-fonts')) return;
  const link = document.createElement('link');
  link.id = 'lm-curated-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_CSS;
  document.head.appendChild(link);
}

/**
 * The curated entry matching a CSS font-family value, by its first family.
 *
 * @param {string} value
 * @returns {string | null}  The CSS value of the match, or null for a custom stack.
 */
export function matchCuratedFont(value) {
  const first = (s) => String(s ?? '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  const want = first(value);
  const hit = CURATED_FONTS.find(([, css]) => first(css) === want);
  return hit ? hit[1] : null;
}
