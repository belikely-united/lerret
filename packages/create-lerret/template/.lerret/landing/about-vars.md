# Cascading `vars` — change one color, re-skin everything

Open `.lerret/config.json`. You'll see a `vars` block like this:

```json
{
  "vars": {
    "brandColor": "#B85B33",
    "accentColor": "#F4D5C3",
    "neutralDark": "#1A1814",
    "neutralMid":  "#5A4F46",
    "neutralLight":"#F7F4F0"
  }
}
```

Lerret injects every key as a **CSS custom property** on each artboard root.
So `brandColor` becomes `var(--brandColor)` in your component CSS — and any
`config.json` deeper in the tree (in `landing/`, in a subgroup, etc.) merges
on top via Lerret's v1 deep-merge cascade.

## Try it

1. In `.lerret/config.json`, change `vars.brandColor` from `#B85B33` to a
   blue you like — try `#3D5A80`.
2. Save the file.
3. Watch this page: the headline accent, the CTA pill border, the
   off-axis radial gradient — every red here flips to blue.

## Per-page override

You can drop a `landing/config.json` with its own `vars` block to override
just this page's colors without touching the project root. Example:

```json
{
  "vars": { "brandColor": "#0E7A5F" }
}
```

Now `landing/` is green; every other page still uses the project-root
`brandColor`. Same mechanism scales down: a `landing/promo/config.json`
overrides just `promo/`, and so on.

## What's the four-tier resolution chain again?

Read `social/about-data-files.md` — it walks through the full prop-resolution
order (data file → cascaded `vars` → `propsSchema` defaults → component
defaults) with the concrete file paths involved.
