# Welcome to Lerret

This project is a five-page teaching tour. Every page below demos one core
Lerret capability inline — read the artboards in order and you'll know how
the canvas works without opening the docs.

This page (`intro/`) sets `excludeFromExport: true` in its `config.json`, so
it stays on the canvas but is **skipped** by `@lerret/cli export`. Delete
`intro/config.json` to include this card in exports.

## `landing/` — cascading `vars`

A landing-page hero (1200×630) that reads project-root `config.json` `vars`
through CSS custom properties (`var(--brandColor)`). Edit `vars.brandColor`
in `.lerret/config.json` and every artboard in `landing/` re-colors instantly.
The Markdown card in that folder walks through the mechanism.

## `social/` — variants + data files

One component (`tw-banner.jsx`) with three named exports — each becomes its
own artboard. A second component (`og-card.jsx`) declares a `propsSchema` in
its `meta` export and reads a co-located `og-card.data.json`. The Markdown
card in that folder explains the four-tier prop-resolution chain naming the
files involved.

## `brand/` — `propsSchema` validation

Two artboards of the same component. The first has a deliberately incomplete
`<asset>.data.json` so the ⚠️ validation badge fires on first load — click
it to see what's missing. The paired variant has a complete data file and
shows no badge. The Markdown card explains the badge and how to dismiss it
by fixing the data.

## `live/` — auto-refresh

Two artboards driven by auto-refresh: a digital clock showing HH:MM:SS at a
1 s tick and an auto-incrementing counter that visibly increments every
second. Each timer is declared in the asset's own co-located config file
(`clock.config.json`, `counter.config.json`, each `{ "autoRefresh": 1000 }`).
The Markdown card in that folder shows you exactly which value to edit to
change the tick interval (try `100` for fast, `5000` for slow).

---

When you're done reading, delete the samples and start building:

```sh
npx @lerret/cli@latest clear --all
```
