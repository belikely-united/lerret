// brand-import.js — "Import from website": read a product page (a website, an
// App Store / Microsoft Store / Google Play listing) and suggest its brand —
// name, tagline, colours, fonts and logo images — for the user to review in
// the studio's brand setup.
//
// Runs in the CLI dev server because the browser can't read other origins.
// Only public http(s) addresses are fetched: every hop of every redirect is
// resolved and refused if it points at a loopback, private, link-local or
// otherwise non-public address; responses are size- and time-capped.
//
// The extraction functions are pure (HTML/CSS text in, signals out) so they
// are tested without the network.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_HTML = 2 * 1024 * 1024;
const MAX_CSS = 600 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 Lerret-brand-import';

// ── Network safety ──────────────────────────────────────────────────────────

/**
 * Whether an IP address is on the public internet (not loopback, private,
 * link-local, CGNAT, multicast, reserved, or their IPv6 equivalents).
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isPublicAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return false;
    if (x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff')) return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicAddress(mapped[1]);
    return true;
  }
  return false;
}

/** Throw unless `url` is http(s) and its host resolves only to public addresses. */
async function assertPublicUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('That doesn’t look like a web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) links can be imported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error(`Couldn’t find ${u.hostname}.`);
  if (!addrs.every((a) => isPublicAddress(a.address))) throw new Error('That address isn’t on the public internet.');
  return u;
}

/**
 * Fetch a public URL, following up to 5 redirects (each hop re-checked), and
 * read at most `maxBytes` of the body.
 *
 * @param {string} url
 * @param {{ maxBytes: number, accept?: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ url: string, contentType: string, bytes: Uint8Array }>}
 */
export async function safeFetch(url, { maxBytes, accept = '*/*', fetchImpl = fetch }) {
  let current = url;
  for (let hop = 0; hop < 6; hop += 1) {
    await assertPublicUrl(current);
    const res = await fetchImpl(current, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(Math.min(size, maxBytes));
    let at = 0;
    for (const c of chunks) {
      bytes.set(c.subarray(0, bytes.length - at), at);
      at += c.length;
      if (at >= bytes.length) break;
    }
    return { url: current, contentType: res.headers.get('content-type') || '', bytes };
  }
  throw new Error('Too many redirects.');
}

// ── Extraction (pure) ───────────────────────────────────────────────────────

const decodeEntities = (s) =>
  String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

/** Attributes of every `<tag …>` in `html`, as lowercase-keyed objects. */
function tags(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = {};
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    for (let a = ar.exec(m[1]); a; a = ar.exec(m[1])) attrs[a[1].toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '');
    out.push(attrs);
  }
  return out;
}

const absolute = (href, base) => {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
};

/** Strip store/marketing suffixes from a page title: "Acme on the App Store" → "Acme". */
export function cleanAppName(title) {
  return String(title ?? '')
    .replace(/\s+[-–—|·:]\s+.*$/, '')
    .replace(/\s+on the App Store$|\s+- Apps on Google Play$|\s+- Official app in the Microsoft Store$/i, '')
    .replace(/^Get\s+/i, '')
    .trim();
}

/** `https://www.notion.com/x` → `notion`. */
function domainStem(url) {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    return squashName(parts.length > 1 ? parts[parts.length - 2] : parts[0]);
  } catch {
    return '';
  }
}

/** Lower-case letters and digits only, for loose name matching. */
function squashName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Everything a page's HTML says about its brand.
 *
 * @param {string} html
 * @param {string} baseUrl
 */
export function extractHtmlSignals(html, baseUrl) {
  const metas = tags(html, 'meta');
  const meta = (...keys) => {
    for (const k of keys) {
      const m = metas.find((x) => (x.property || x.name || '').toLowerCase() === k);
      if (m?.content) return m.content;
    }
    return '';
  };
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  const name = cleanAppName(meta('og:site_name', 'application-name', 'apple-mobile-web-app-title') || meta('og:title') || title);
  const tagline = meta('og:description', 'description', 'twitter:description').slice(0, 200);

  const links = tags(html, 'link');
  const icons = [];
  for (const l of links) {
    const rel = (l.rel || '').toLowerCase();
    if (!l.href) continue;
    if (/apple-touch-icon|(^|\s)icon(\s|$)|mask-icon/.test(rel)) {
      const size = Math.max(0, ...String(l.sizes || '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
      icons.push({ url: absolute(l.href, baseUrl), source: rel.includes('apple') ? 'App icon' : 'Site icon', score: rel.includes('apple') ? 180 + size : size || (/\.svg/i.test(l.href) ? 300 : 32) });
    }
  }
  const og = meta('og:image', 'twitter:image');
  if (og) icons.push({ url: absolute(og, baseUrl), source: 'Preview image', score: 120 });
  // A "logo" image is the site's OWN logo only when it names the app or the
  // domain — home pages are full of customer / partner logo strips.
  const own = [squashName(name), domainStem(baseUrl)].filter((x) => x && x.length >= 3);
  for (const img of tags(html, 'img')) {
    const hint = `${img.src || ''} ${img.alt || ''} ${img.class || ''} ${img.id || ''}`;
    if (!img.src || /data:/.test(img.src) || !/logo|brand|wordmark/i.test(hint)) continue;
    const isOwn = own.some((o) => squashName(hint).includes(o));
    icons.push({
      url: absolute(img.src, baseUrl),
      source: 'Logo on the page',
      score: isOwn ? (/\.svg/i.test(img.src) ? 400 : 250) : 1,
    });
  }
  const manifest = links.find((l) => /manifest/i.test(l.rel || ''))?.href;
  const stylesheets = links.filter((l) => /stylesheet/i.test(l.rel || '') && l.href).map((l) => absolute(l.href, baseUrl)).filter(Boolean);
  const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') +
    '\n' + tags(html, '[a-z0-9]+').map((a) => a.style || '').join(';');
  const googleFonts = stylesheets
    .filter((h) => /fonts\.googleapis\.com/.test(h))
    .flatMap((h) => [...new URL(h).searchParams.getAll('family')].map((f) => f.split(':')[0].replace(/\+/g, ' ')));

  return {
    name,
    tagline,
    themeColor: meta('theme-color'),
    icons: dedupeBy(icons.filter((i) => i.url), (i) => i.url).sort((a, b) => b.score - a.score),
    manifest: manifest ? absolute(manifest, baseUrl) : null,
    stylesheets: stylesheets.filter((h) => !/fonts\.googleapis\.com/.test(h)),
    inlineCss,
    googleFonts,
  };
}

function dedupeBy(list, key) {
  const seen = new Set();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const GENERIC_FONTS = /^(inherit|initial|unset|serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica|helvetica neue|arial|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|var\(.*)$/i;

/**
 * Colours and font families used in CSS, by frequency.
 *
 * @param {string} css
 * @returns {{ colors: Map<string, number>, fonts: Map<string, number> }}
 */
export function extractCssSignals(css) {
  const colors = new Map();
  const add = (hex) => colors.set(hex, (colors.get(hex) || 0) + 1);
  for (const m of String(css).matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    add(`#${h.toUpperCase()}`);
  }
  for (const m of String(css).matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) {
    add(`#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase()}`);
  }
  const fonts = new Map();
  for (const m of String(css).matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].replace(/['"!]|important/g, '').trim();
    if (first && !GENERIC_FONTS.test(first)) fonts.set(first, (fonts.get(first) || 0) + 1);
  }
  return { colors, fonts };
}

/** 0 (grey) … 255 (vivid). */
const chroma = (hex) => {
  const v = hex.slice(1).match(/../g).map((x) => parseInt(x, 16));
  return Math.max(...v) - Math.min(...v);
};
const lightness = (hex) => {
  const v = hex.slice(1).match(/../g).map((x) => parseInt(x, 16));
  return (Math.max(...v) + Math.min(...v)) / 2;
};

/**
 * The brand palette: the declared theme colour first, then the most-used
 * vivid colours, then one dark and one light neutral — at most `max`.
 *
 * @param {Map<string, number>} counts
 * @param {string[]} declared  theme-color / manifest colours.
 * @param {number} [max]
 * @returns {string[]}
 */
export function rankColors(counts, declared = [], max = 6) {
  const norm = (c) => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(c || '').trim());
    if (!m) return null;
    return `#${(m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1]).toUpperCase()}`;
  };
  const out = [];
  const push = (c) => {
    const h = norm(c);
    // Skip near-duplicates (each channel within 24).
    if (h && !out.some((o) => o.slice(1).match(/../g).every((x, i) => Math.abs(parseInt(x, 16) - parseInt(h.slice(1).match(/../g)[i], 16)) < 24))) out.push(h);
  };
  declared.forEach(push);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  sorted.filter((c) => chroma(c) > 40).slice(0, max).forEach((c) => out.length < max - 2 && push(c));
  const dark = sorted.find((c) => chroma(c) <= 40 && lightness(c) < 60);
  const light = sorted.find((c) => chroma(c) <= 40 && lightness(c) > 230);
  if (dark) push(dark);
  if (light) push(light);
  return out.slice(0, max);
}

// ── Orchestration ───────────────────────────────────────────────────────────

const text = (bytes) => new TextDecoder().decode(bytes);
const sniffImage = (bytes, contentType) => {
  if (/^image\//.test(contentType)) return contentType.split(';')[0];
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  if (text(b.slice(0, 200)).includes('<svg')) return 'image/svg+xml';
  return null;
};

// Free Google families a site's font name may contain ("NotionInter" → Inter).
const FREE_FAMILIES = [
  'Plus Jakarta Sans', 'IBM Plex Sans', 'IBM Plex Serif', 'Source Sans 3', 'Source Serif 4', 'Space Grotesk',
  'DM Serif Display', 'Playfair Display', 'Libre Baskerville', 'EB Garamond', 'Open Sans', 'Work Sans', 'DM Sans',
  'Noto Sans', 'Noto Serif', 'Montserrat', 'Merriweather', 'Bebas Neue', 'Inter', 'Roboto', 'Poppins', 'Lato',
  'Nunito', 'Manrope', 'Rubik', 'Outfit', 'Geist', 'Lora', 'Fraunces', 'Raleway', 'Oswald',
];

/**
 * The closest free (Google Fonts) family for a font a site serves itself:
 * a free family named inside it, else a serif or a sans by its name.
 *
 * @param {string} family
 * @returns {string}
 */
export function closestFreeFont(family) {
  const name = squashName(family);
  const named = FREE_FAMILIES.find((f) => name.includes(squashName(f)));
  if (named) return named;
  if (/sans|grotesk|grotesque|helvetica|arial|neue|circular|graphik|system|ui/i.test(family)) return 'Inter';
  if (/serif|lyon|tiempos|georgia|garamond|times|caslon|baskerville|canela|freight|publico|text|book/i.test(family)) return 'Source Serif 4';
  return 'Inter';
}

/**
 * Import a brand from a link.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<{ app: { name: string, tagline: string, url: string }, colors: string[],
 *   fonts: string[], logos: Array<{ source: string, url: string, mimeType: string, base64: string }> }>}
 */
export async function importBrand(url, { fetchImpl = fetch } = {}) {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const page = await safeFetch(target, { maxBytes: MAX_HTML, accept: 'text/html,application/xhtml+xml', fetchImpl });
  const html = text(page.bytes);
  const sig = extractHtmlSignals(html, page.url);

  const declared = [sig.themeColor];
  let icons = sig.icons;
  if (sig.manifest) {
    try {
      const m = JSON.parse(text((await safeFetch(sig.manifest, { maxBytes: 200 * 1024, fetchImpl })).bytes));
      declared.push(m.theme_color, m.background_color);
      if (!sig.name && m.name) sig.name = m.name;
      for (const i of m.icons || []) {
        const size = Number(String(i.sizes || '').split('x')[0]) || 0;
        const u = absolute(i.src, sig.manifest);
        if (u) icons.push({ url: u, source: 'App icon', score: 200 + size });
      }
      icons = dedupeBy(icons, (i) => i.url).sort((a, b) => b.score - a.score);
    } catch {
      // A broken manifest just means fewer suggestions.
    }
  }

  let css = sig.inlineCss;
  for (const href of sig.stylesheets.slice(0, 8)) {
    if (css.length > 1.5 * 1024 * 1024) break;
    try {
      css += `\n${text((await safeFetch(href, { maxBytes: MAX_CSS, accept: 'text/css', fetchImpl })).bytes)}`;
    } catch {
      // skip unreachable stylesheets
    }
  }
  const cssSig = extractCssSignals(css);
  const colors = rankColors(cssSig.colors, declared.filter(Boolean));
  // Google Fonts links are free to use as-is; a site's own font files are
  // usually private, so those become the closest free (Google) family.
  const fonts = dedupeBy(
    [...sig.googleFonts, ...[...cssSig.fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => closestFreeFont(f))],
    (f) => f.toLowerCase(),
  ).slice(0, 4);

  const logos = [];
  // Other companies' logos (score 1) only when nothing of the site's own exists.
  // One copy of each icon: `icon_512.png`, `icon_maskable_192.png`… are the
  // same picture at other sizes (icons are sorted best-first, so the first wins).
  const sameIcon = (u) => String(u).split('?')[0].replace(/maskable|\d+x?\d*/gi, '').replace(/[-_.]+/g, '-');
  const ownIcons = dedupeBy(icons.filter((i) => i.score > 1), (i) => sameIcon(i.url));
  for (const icon of (ownIcons.length ? ownIcons : icons).slice(0, 8)) {
    if (logos.length >= 4) break;
    try {
      const img = await safeFetch(icon.url, { maxBytes: MAX_IMAGE, accept: 'image/*', fetchImpl });
      const mimeType = sniffImage(img.bytes, img.contentType);
      if (!mimeType || img.bytes.length < 200) continue;
      logos.push({ source: icon.source, url: icon.url, mimeType, base64: Buffer.from(img.bytes).toString('base64') });
    } catch {
      // skip
    }
  }

  return { app: { name: sig.name, tagline: sig.tagline, url: page.url }, colors, fonts, logos };
}
