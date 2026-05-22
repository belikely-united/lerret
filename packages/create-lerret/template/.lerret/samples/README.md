# Lerret sample set

This Markdown file is itself an asset on the canvas. Lerret renders any `.md`
file under `.lerret/` as a document card alongside the React assets in the
same folder. Edit me to see live re-render.

## What's in this folder

- **landing-hero.jsx** — a marketing hero (1600×900). Tier-1 props come from
  `landing-hero.data.json`. Delete that file to see the `propsSchema`
  defaults take over.
- **feature-grid.jsx** — one component, four artboards. Demonstrates
  `meta.variants` with per-variant data keyed in `feature-grid.data.json`.
- **quote-card.jsx** — Instagram-square (1080×1080) with a `tone` enum prop.
  Switch tones via the in-studio Data editor.
- **poster.jsx** — tall typographic poster (1080×1620). Pure component, no
  data file — composition lives in the JSX.

## Move past the samples

When you're ready to clear the deck and build your own:

```sh
npx @lerret/cli@latest clear --all
```

That removes every sample (this file too) but **keeps**
`.lerret/config.json` (your vars) and `.lerret/_fonts/` (your fonts). To
remove just one, name it:

```sh
npx @lerret/cli@latest clear samples/feature-grid.jsx
```

## What you'd build next

A `.jsx` file under `.lerret/` becomes an artboard. The full conventions
(meta, propsSchema, variants, cascading config, co-located data, auto-
registered fonts) are documented inside this project's bundled AI rules.
If you have Claude Code, Cursor, Copilot, or another supported tool open,
they already know — try asking *"add a new asset under .lerret/samples
that's a Bluesky banner"*.
