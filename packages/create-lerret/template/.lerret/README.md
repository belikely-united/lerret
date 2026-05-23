# Lerret default teaching preset

Welcome. This `.lerret/` folder is a **five-page teaching project** — every page
demos one core Lerret capability inline so you learn by reading the artboards,
not by reading documentation.

## The five pages

A folder under `.lerret/` is a page. The studio mounts them alphabetically:

1. **`intro/`** — a tour. A single Markdown card naming what each of the other
   four pages teaches. This page sets `excludeFromExport: true` so it stays in
   the studio canvas but is skipped by `@lerret/cli export`.
2. **`landing/`** — the **cascading `vars`** demo. A landing-page hero
   (1200×630) that reads project-root `config.json` `vars` via CSS custom
   properties. Edit `vars.brandColor` in `.lerret/config.json` and every
   artboard on this page re-colors.
3. **`social/`** — the **variants + data-files** demo. One component with
   three named exports (one artboard per variant), and a second component with
   a `propsSchema` plus a co-located `<asset>.data.json`. The Markdown card
   explains the four-tier prop-resolution chain.
4. **`brand/`** — the **`propsSchema` validation** demo. Two artboards: one
   deliberately under-filled (the ⚠️ badge fires) and a paired complete one
   (no badge). Click the ⚠️ to see what's missing.
5. **`live/`** — the **`liveRefresh`** demo. Two artboards that tick: a
   digital clock (HH:MM:SS, 1 s) and an auto-incrementing counter. Driven by
   the `liveRefresh` block in `live/config.json`.

## Move past the samples

When you're ready to clear the deck and build your own:

```sh
npx @lerret/cli@latest clear --all
```

That removes every page (this file too) but **keeps** `.lerret/config.json`
(your vars) and `.lerret/_fonts/` (your fonts). To remove just one page:

```sh
npx @lerret/cli@latest clear live
```

## What you'd build next

A `.jsx` file under `.lerret/` becomes an artboard. The full conventions
(`meta`, `propsSchema`, variants, cascading config, co-located data,
auto-registered fonts) are documented inside this project's bundled AI rules.
If you have Claude Code, Cursor, Copilot, or another supported tool open,
they already know — try asking *"add a new asset under `.lerret/social/`
that's a Bluesky banner"*.
