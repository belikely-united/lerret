// brand-import.test.js — extraction + safety for "Import from website".

import { describe, expect, it } from 'vitest';

import { isPublicAddress, extractHtmlSignals, extractCssSignals, rankColors, cleanAppName, importBrand } from './brand-import.js';

const HTML = `<!doctype html><html><head>
<title>Acme — Plan your week | Acme Inc</title>
<meta property="og:site_name" content="Acme">
<meta name="description" content="Plan your week in minutes.">
<meta name="theme-color" content="#5B2EFF">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&family=DM+Sans">
<link rel="stylesheet" href="/app.css">
<style>.btn{background:#5b2eff;color:#fff} body{font-family:'Acme Sans', system-ui}</style>
</head><body><img class="site-logo" src="/img/logo.svg" alt="Acme"></body></html>`;

describe('extractHtmlSignals', () => {
  it('reads name, tagline, theme colour, icons, manifest, stylesheets and Google Fonts', () => {
    const s = extractHtmlSignals(HTML, 'https://acme.example/home');
    expect(s.name).toBe('Acme');
    expect(s.tagline).toBe('Plan your week in minutes.');
    expect(s.themeColor).toBe('#5B2EFF');
    expect(s.manifest).toBe('https://acme.example/site.webmanifest');
    expect(s.stylesheets).toEqual(['https://acme.example/app.css']);
    expect(s.googleFonts).toEqual(['Poppins', 'DM Sans']);
    // An SVG logo on the page ranks above the touch icon, which ranks above the favicon.
    expect(s.icons.map((i) => i.url)).toEqual([
      'https://acme.example/img/logo.svg',
      'https://acme.example/apple-touch-icon.png',
      'https://acme.example/favicon.ico',
    ]);
  });

  it('cleans store suffixes from names', () => {
    expect(cleanAppName('Acme on the App Store')).toBe('Acme');
    expect(cleanAppName('Acme - Apps on Google Play')).toBe('Acme');
    expect(cleanAppName('Get Acme - Official app in the Microsoft Store')).toBe('Acme');
  });
});

describe('colours + fonts', () => {
  it('counts CSS colours and real font families (not system stacks)', () => {
    const { colors, fonts } = extractCssSignals('.a{color:#5b2eff}.b{background:rgb(91, 46, 255)}.c{font-family:"Acme Sans",sans-serif}.d{font-family:system-ui}');
    expect(colors.get('#5B2EFF')).toBe(2);
    expect([...fonts.keys()]).toEqual(['Acme Sans']);
  });

  it('ranks the declared colour first, then vivid ones, then a dark and a light neutral, without near-duplicates', () => {
    const counts = new Map([['#5B2EFF', 9], ['#5C2FFE', 4], ['#FF6A88', 3], ['#111111', 7], ['#FAFAFA', 8], ['#888888', 2]]);
    expect(rankColors(counts, ['#5b2eff'])).toEqual(['#5B2EFF', '#FF6A88', '#111111', '#FAFAFA']);
  });
});

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local and CGNAT ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
  });

  it('refuses to import from a local address', async () => {
    await expect(importBrand('http://127.0.0.1:5190/')).rejects.toThrow(/public internet/);
    await expect(importBrand('ftp://example.com')).rejects.toThrow();
  });
});
