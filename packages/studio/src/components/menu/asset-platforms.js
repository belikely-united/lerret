// asset-platforms.js — the platform → format size presets offered when
// creating a new component asset.
//
// The "New asset" dialog first asks WHERE the asset will be published, then
// offers that platform's image formats as the starting artboard size (written
// to the starter's `meta.dimensions`). Sizes are each platform's recommended
// upload size; the artboard's size chip can change them any time, so a preset
// is a starting point, not a lock-in.
//
// Pure data — no React — so tests and other surfaces can import it cheaply.

/**
 * @typedef {object} AssetFormat
 * @property {string} id      Stable id, unique within its platform.
 * @property {string} label   Short human name ("Story", "Feed post").
 * @property {number} width   Pixels.
 * @property {number} height  Pixels.
 */

/**
 * @typedef {object} AssetPlatform
 * @property {string} id
 * @property {string} label
 * @property {ReadonlyArray<AssetFormat>} formats  First entry is the default pick.
 */

/** @type {ReadonlyArray<AssetPlatform>} */
export const ASSET_PLATFORMS = Object.freeze([
  {
    id: 'instagram',
    label: 'Instagram',
    formats: [
      { id: 'post-portrait', label: 'Post · portrait', width: 1080, height: 1350 },
      { id: 'post-square', label: 'Post · square', width: 1080, height: 1080 },
      { id: 'post-grid', label: 'Post · 3:4 grid', width: 1080, height: 1440 },
      { id: 'story', label: 'Story', width: 1080, height: 1920 },
      { id: 'reel', label: 'Reel cover', width: 1080, height: 1920 },
      { id: 'post-landscape', label: 'Post · landscape', width: 1080, height: 566 },
      { id: 'profile', label: 'Profile photo', width: 320, height: 320 },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    formats: [
      { id: 'post-square', label: 'Feed post · square', width: 1080, height: 1080 },
      { id: 'post-portrait', label: 'Feed post · portrait', width: 1080, height: 1350 },
      { id: 'link', label: 'Link share', width: 1200, height: 630 },
      { id: 'story', label: 'Story', width: 1080, height: 1920 },
      { id: 'cover', label: 'Page cover', width: 851, height: 315 },
      { id: 'event', label: 'Event cover', width: 1920, height: 1005 },
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    formats: [
      { id: 'post-square', label: 'Post · square', width: 1200, height: 1200 },
      { id: 'post-portrait', label: 'Post · portrait', width: 1080, height: 1350 },
      { id: 'post-landscape', label: 'Post · landscape', width: 1200, height: 627 },
      { id: 'article', label: 'Article cover', width: 1920, height: 1080 },
      { id: 'banner', label: 'Profile banner', width: 1584, height: 396 },
      { id: 'company-cover', label: 'Company cover', width: 1128, height: 191 },
    ],
  },
  {
    id: 'x',
    label: 'X (Twitter)',
    formats: [
      { id: 'post-landscape', label: 'Post · landscape', width: 1600, height: 900 },
      { id: 'post-square', label: 'Post · square', width: 1080, height: 1080 },
      { id: 'card', label: 'Link card', width: 1200, height: 628 },
      { id: 'header', label: 'Header', width: 1500, height: 500 },
    ],
  },
  {
    id: 'producthunt',
    label: 'Product Hunt',
    formats: [
      { id: 'gallery', label: 'Gallery image', width: 1270, height: 760 },
      { id: 'thumbnail', label: 'Thumbnail', width: 240, height: 240 },
      { id: 'social', label: 'Launch social card', width: 1200, height: 630 },
    ],
  },
  {
    id: 'appstore',
    label: 'App Store',
    formats: [
      { id: 'iphone-69', label: 'iPhone 6.9″ screenshot', width: 1320, height: 2868 },
      { id: 'iphone-65', label: 'iPhone 6.5″ screenshot', width: 1284, height: 2778 },
      { id: 'ipad-13', label: 'iPad 13″ screenshot', width: 2064, height: 2752 },
      { id: 'mac', label: 'Mac screenshot', width: 2880, height: 1800 },
      { id: 'icon', label: 'App icon', width: 1024, height: 1024 },
    ],
  },
  {
    id: 'playstore',
    label: 'Google Play',
    formats: [
      { id: 'phone', label: 'Phone screenshot', width: 1080, height: 1920 },
      { id: 'tablet', label: 'Tablet screenshot', width: 1600, height: 2560 },
      { id: 'feature', label: 'Feature graphic', width: 1024, height: 500 },
      { id: 'icon', label: 'App icon', width: 512, height: 512 },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    formats: [
      { id: 'thumbnail', label: 'Video thumbnail', width: 1280, height: 720 },
      { id: 'shorts', label: 'Shorts cover', width: 1080, height: 1920 },
      { id: 'banner', label: 'Channel banner', width: 2560, height: 1440 },
      { id: 'post', label: 'Community post', width: 1080, height: 1080 },
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    formats: [
      { id: 'pin', label: 'Standard pin', width: 1000, height: 1500 },
      { id: 'square', label: 'Square pin', width: 1000, height: 1000 },
      { id: 'long', label: 'Long pin', width: 1000, height: 2100 },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    formats: [
      { id: 'cover', label: 'Video cover', width: 1080, height: 1920 },
      { id: 'profile', label: 'Profile photo', width: 200, height: 200 },
    ],
  },
  {
    id: 'web',
    label: 'Web & email',
    formats: [
      { id: 'og', label: 'Open Graph image', width: 1200, height: 630 },
      { id: 'hero', label: 'Hero banner', width: 1920, height: 1080 },
      { id: 'slide', label: 'Slide · 16:9', width: 1920, height: 1080 },
      { id: 'email', label: 'Email header', width: 600, height: 200 },
    ],
  },
]);

/** Pseudo-platform id for the free-form W×H option. */
export const CUSTOM_PLATFORM_ID = 'custom';

/**
 * @param {string} id
 * @returns {AssetPlatform | undefined}
 */
export function findPlatform(id) {
  return ASSET_PLATFORMS.find((p) => p.id === id);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function trimDecimals(n) {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * A readable aspect ratio for a size: the exact reduced ratio when it is small
 * (`9:16`, `4:5`), otherwise a two-decimal approximation (`1.91:1`).
 *
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function formatRatio(width, height) {
  const d = gcd(width, height);
  const w = width / d;
  const h = height / d;
  if (w <= 21 && h <= 21) return `${w}:${h}`;
  const r = width / height;
  return r >= 1 ? `${trimDecimals(r)}:1` : `1:${trimDecimals(1 / r)}`;
}
