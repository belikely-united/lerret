---
name: author
description: Author and edit visual assets inside a Lerret project. Use whenever you create, modify, or refactor a `.jsx`/`.tsx` file under a `.lerret/` directory, change `config.json`, or work with `.data.json`/`.data.js`, `_fonts/`, or `assets/` files in that tree. Covers Lerret's conventions (meta export, propsSchema, variants, four-tier prop resolution, cascading config, auto-registered fonts, ambient CSS vars) and the `@lerret/cli` surface (`create-lerret`, `dev`, `export`). Bakes in aesthetic direction so generated visuals are distinctive, cohesive, and production-grade — not generic AI output.
allowed-tools: Read, Write, Edit, Glob, Bash(npx @lerret/cli@latest *)
---

# Authoring Lerret assets (plugin)

This skill runs inside Claude Code as the Lerret plugin. **You are the designer** — on this path there is no separate Lerret AI service, provider, or API key. You read and write the project's `.jsx` files directly and render them with the CLI to check your work.

## The loop
1. **Locate the project** — `Glob` `**/.lerret/**/*.jsx` to find existing assets and match their conventions.
2. **Create or edit** the `.jsx` asset (plus any co-located `<Name>.data.json` / `<Name>.config.json`).
3. **Render to verify** — export the asset's **page/group folder** (the export scope is a folder, never a single file), run from the project root:
   ```sh
   npx @lerret/cli@latest export .lerret/<page-or-group> --out ./.lerret-preview
   ```
4. **Read the PNG** (`./.lerret-preview/<…>/<Name>.png`) and iterate from step 2.

Everything below is the authoring contract and the aesthetic bar — follow it exactly.

You are editing inside a Lerret project. Lerret is a folder-of-React-files design canvas: every `.jsx` or `.tsx` file under `.lerret/` is a visual asset that renders on the canvas. There is no UI framework to fight, no design system to inherit — only React, the conventions below, and the aesthetic bar.

This guidance exists for two reasons:

1. Get the **mechanics** right the first time. Lerret's conventions compose standard React with a small set of Lerret-specific contracts (`meta`, cascading `config.json`, co-located data files, auto-registered fonts). If you miss them, the asset breaks or its props don't resolve.
2. Get the **aesthetic** right the first time. The default failure mode of LLM-generated UI is timid, generic, purple-gradient slop. Lerret is for people who care about how their visuals look — match that bar.

## Project layout

A Lerret project is a folder called `.lerret/`. Anything inside it is part of the canvas. The default scaffold ships a **five-page teaching preset** — every page demos one core capability:

```
.lerret/
  config.json                       # Root config — vars, presentation
  README.md                         # Markdown asset — renders as a document card
  _fonts/                           # Drop .woff2/.woff/.ttf/.otf here — auto-registered
    LerretFixtureMono.woff2
  intro/                            # A folder = a section/page on the canvas
    config.json                     # Per-folder config — excludeFromExport here
    welcome.md                      # Markdown asset (tour of the other pages)
  landing/                          # Section/page — cascading-vars demo
    landing-hero.jsx                # Asset (default-export React component)
    about-vars.md                   # Markdown explainer co-located with the asset
  social/                           # Variants + data-files demo
    tw-banner.jsx                   # Variants asset — extra named exports
    tw-banner.data.json             # Per-variant data, keyed by export name
    og-card.jsx                     # propsSchema with a select-enum (`tone`)
    og-card.data.json               # Co-located data for that asset
    about-data-files.md
  brand/                            # propsSchema validation-badge demo
    business-card.jsx               # propsSchema with a required prop (no default)
    business-card.data.json         # Default slice deliberately incomplete
    about-validation.md
  live/                             # auto-refresh demo
    clock.jsx                       # Re-renders every 1 s via auto-refresh
    clock.config.json               # `{ "autoRefresh": 1000 }` — co-located with the asset
    counter.jsx                     # Same — pure local state + auto-refresh
    counter.config.json             # `{ "autoRefresh": 1000 }`
    about-live-refresh.md
```

Folders nest as deep as you want. Each folder becomes a section on the canvas. The preset folders (`intro/`, `landing/`, `social/`, `brand/`, `live/`) are scaffolding for first-run learning — the user is expected to clear them (via `@lerret/cli clear --all`) and replace with their own once they understand the conventions.

## The asset contract

Every asset is a `.jsx` or `.tsx` file with **one default export** — a React component that renders the artboard's full surface. Use `width: '100%'; height: '100%'` on the outer wrapper; Lerret sizes the artboard from `meta.dimensions`.

Optional named export `meta` declares artboard metadata:

```jsx
export const meta = {
  dimensions: { width: 1600, height: 900 },   // artboard size in CSS px
  label: 'Twitter / X banner',                // shown in the canvas header
  tags: ['social', 'twitter', 'banner'],      // freeform filter tags
  propsSchema: {                              // typed prop knobs (UI + defaults)
    headline: {
      type: 'string',
      default: 'Your project name',
      description: 'Main headline on the banner.',
      required: true,
    },
    showAccentBar: { type: 'boolean', default: true },
    tone: { type: 'select', default: 'ocean', options: ['ocean', 'sand', 'slate'] },
  },
};

export default function TwitterBanner({ headline = 'Your project name', showAccentBar = true }) {
  return (
    <div style={{ width: '100%', height: '100%' /* …rest of styles… */ }}>
      {/* artboard */}
    </div>
  );
}
```

The `meta` export is **optional**. An asset without it still renders; the canvas falls back to a default artboard size. Add `meta` when you need a specific export size, a nicer label, or `propsSchema`-driven knobs.

The field is `dimensions`. Not `exportDimensions`, not `size`, not `width`/`height` at the top level.

## Variants — additional named exports

Beyond `default`, every additional named export is a **variant** of the asset. Each variant renders as its own artboard.

```jsx
export default function Card({ title }) { /* … */ }
export const Dark = (props) => <Card {...props} theme="dark" />;
export const Wide = (props) => <Card {...props} layout="wide" />;
```

To feed each variant its own data, use a keyed `.data.json`:

```json
{
  "default": { "title": "Default card" },
  "Dark":    { "title": "Dark card" },
  "Wide":    { "title": "Wide card" }
}
```

(A flat shared-data object — without per-variant keys — applies to every variant.)

## Co-located data files

Two filenames are recognised next to an asset:

- `<AssetName>.data.json` — static data, parsed as JSON.
- `<AssetName>.data.js` — dynamic data, default-export an object (or a function returning one).

When **both** exist, `.data.js` wins. Most assets need only `.data.json`.

The data file shares the asset's basename — `og-card.jsx` pairs with `social/og-card.data.json`. Co-location is strict: the data file must be in the same folder as the asset. Variants follow the same rule: `social/tw-banner.jsx` pairs with `social/tw-banner.data.json`, keyed by each variant's export name.

## Auto-refresh — making an asset tick

Most assets render once and hold still — correct for a banner, poster, or OG card. Some assets *should* tick on a timer: a clock, a counter, a time-of-day greeter, a live dashboard. That timer re-render is **auto-refresh**, and it is configured **per asset** in a co-located `<AssetName>.config.json`:

```json
// Clock.config.json — sits next to Clock.jsx
{ "autoRefresh": 1000 }
```

- The file shares the asset's basename, same co-location rule as `<AssetName>.data.json` — `live/clock.jsx` pairs with `live/clock.config.json`.
- `autoRefresh` is the interval in **milliseconds**. The studio re-renders the asset on that cadence; the component just reads `new Date()` / `Date.now()` (or normal React state) to compute the current value.
- **No file, or no `autoRefresh` key, means off** — the default. Minimum is **16 ms** (one 60fps frame); component assets only.
- It is **per asset, not per folder** — there is no folder-level auto-refresh, no cascade, no name-keyed map. To make a new asset tick, drop its own `<Name>.config.json` beside it.
- `<AssetName>.config.json` is a tool-managed companion: it travels with the asset on move / rename / duplicate / delete, exactly like the data file. Keep the asset's own logic in the `.jsx` — this file holds only settings.

(Don't confuse auto-refresh with **live reload**, the file-save HMR that repaints every asset when you edit and save its source. Auto-refresh is the no-file-change timer re-render; live reload is the editor loop. Different mechanisms.)

## Four-tier prop resolution

Every prop the component receives is resolved in this fixed order. First tier that supplies the prop wins. Per-prop independence — different props can come from different tiers in the same render.

1. **Data** — the matching value from `<AssetName>.data.json` / `.data.js` (per-variant key when variants exist, otherwise the shared object).
2. **Vars** — the cascaded `vars` block from the asset's folder's effective `config.json`. Use for project-wide tokens (brand colours, accent colours) that you want available without repeating them per asset.
3. **propsSchema default** — the `default` field inside each prop's schema descriptor.
4. **Component default** — React's own default parameter (`function Foo({ x = 'fallback' }) {}`).

If you change a prop's default in `propsSchema`, you don't also need to change the component's default parameter — but keep them in sync for code that's read without running.

## Cascading `config.json`

Every folder may contain a `config.json`. Child configs **shallow-merge over** parent configs by top-level key. Known keys:

- `vars` — object of string/number tokens. Available as ambient CSS custom properties (`var(--brandColor)` etc.) on the wrapper around your component, and as Tier-2 props on `propsSchema` keys with matching names.
- `presentation` — canvas presentation, e.g. `{ background: '#f0e8d8' }` paints this folder's section.
- `colors`, `fonts` — design tokens (free-form objects, kept for future tooling; safe to use today).

**Auto-refresh is not a folder key.** Re-rendering an asset on a timer is configured **per asset**, in a co-located `<AssetName>.config.json` — never in the folder `config.json`. See the auto-refresh section below.

Example root config:

```json
{
  "vars": {
    "brandColor": "#3D5A80",
    "accentColor": "#E0FBFC",
    "neutralDark": "#1B2A3B",
    "neutralLight": "#F4F7FA"
  }
}
```

In an asset under that folder you can write `style={{ color: 'var(--accentColor)' }}` or simply destructure a `brandColor` prop if your `propsSchema` declares one — Tier 2 will fill it from `vars`.

A folder-level config overrides the parent on a per-top-level-key basis. Setting `vars` in a child **replaces** the parent's `vars` entirely (no deep merge). If you want to extend rather than replace, repeat the parent keys you care about.

## Fonts — drop a file, use it

Put any `.woff2`, `.woff`, `.ttf`, or `.otf` in `.lerret/_fonts/`. Lerret generates an `@font-face` rule using the file's basename as the `font-family` — zero imports, zero `@font-face` boilerplate.

`.lerret/_fonts/LerretFixtureMono.woff2` becomes:

```jsx
<div style={{ fontFamily: "'LerretFixtureMono', monospace" }}>lerret</div>
```

Quote the family name in inline styles when it contains capital letters or hyphens. Always declare a fallback (`monospace`, `serif`, `sans-serif`) for the few hundred milliseconds before the woff loads — never let the fallback be Arial or Inter (see the aesthetic section).

## Image and asset files

Two rules — apply them by default.

**Rule 1 — component-prefixed, co-located.** When an image is *for* one component, put it in the same folder as the component and prefix its filename with the component's name:

```
social/
  Twitter.jsx
  Twitter-logo.png         # used by Twitter.jsx
  Twitter-bg.jpg
  Twitter-avatar.png
  Youtube.jsx
  Youtube-thumbnail.jpg
```

The pattern is `<ComponentName>-<purpose>.<ext>`. This makes it trivial to:

- scan a folder and see which files belong to which component;
- delete a component + its resources atomically;
- predict where an AI edit will write new images.

Reference these as relative URLs from the component:

```jsx
<img src="./Twitter-logo.png" alt="" />
```

**Rule 2 — shared assets get a descriptive name in `assets/`.** When an image is reused across components, put it in an `assets/` directory (at the project root or at the relevant folder level) and give it a plain descriptive name — no component prefix needed:

```
assets/
  brand-logo.svg
  photo-placeholder.jpg
.lerret/
  social/
    Twitter.jsx          # uses ../../assets/brand-logo.svg
    Instagram.jsx        # also uses ../../assets/brand-logo.svg
```

If you're not sure whether something is shared, prefix it. Renaming later is cheap; untangling co-mingled shared assets later is not.

## The `@lerret/cli` surface

Four commands. All four are zero-install: `npx @lerret/cli@latest <cmd>`, `pnpm dlx @lerret/cli@latest <cmd>`, `yarn dlx @lerret/cli@latest <cmd>`, `bunx @lerret/cli@latest <cmd>`.

### `create-lerret <name> [--no-samples] [--no-ai-rules] [--ai-tools=...]`

Scaffolds a new project. Defaults to copying the sample template (this guidance is part of that scaffold). `--no-samples` produces an empty project — just `.lerret/config.json` with `{ "vars": {} }` — no `_fonts/`, no sample assets. `--no-ai-rules` skips emitting AI-tool integration files; `--ai-tools=claude,cursor,copilot,agents` scopes which ones ship.

Reach for it when: starting a new project. That's it.

### `@lerret/cli dev [--port <n>] [--folder <path>] [--open | --no-open]`

Starts the studio against the nearest `.lerret/` folder with HMR. Edits to assets, data files, and config show up live.

- `--port` — pick a port (default Vite chooses).
- `--folder` — point at a specific `.lerret/` if there are several or yours isn't on the cwd path.
- `--open` / `--no-open` — auto-open the browser (or don't).

Reach for it when: you're authoring. This is the loop you live in.

### `@lerret/cli export [path] [--format png|jpg] [--out <dir>] [--flat] [--data <file>] [--config <file>]`

Headlessly renders artboards to image files. Output mirrors the folder tree by default.

- `[path]` — a **folder** scope: the project root, or a page/group folder inside `.lerret/` (e.g. `.lerret/social`). NOT a single asset file or a variant — to target one asset, scope to the folder that contains it. Omit to export everything.
- `--format` — `png` (default) or `jpg`.
- `--out` — destination directory (default: `./exports`).
- `--flat` — flatten the output instead of mirroring folders.
- `--data` — substitute a data file at export time. The contents override the data tier (tier 1) for **every artboard in this run**, so scope the run with the `[path]` arg (a folder) to target a specific page or group. Useful for batch generation (one folder, N data files swapped in successive runs).
- `--config` — substitute a config file for the run. Useful for re-skinning the whole project (e.g. swap `vars` to render light + dark variants of every asset).

Reach for it when: shipping the actual images. CI-friendly — exit code 0 on success.

### `@lerret/cli clear [path...] [--all] [--yes] [--dry-run]`

Removes sample assets or specific paths from `.lerret/`. Always preserves `.lerret/config.json` and `.lerret/_fonts/` — those are project state, not samples.

- `[path...]` — one or more targets. A bare name (e.g. `intro` or `social`) resolves relative to `.lerret/`; an explicit `./foo` or absolute path is resolved the normal way.
- `--all` — wipe every child of `.lerret/` except the protected ones. Mutually exclusive with positional paths.
- `--yes` — skip the y/N confirmation. Required for non-interactive (no-TTY) runs.
- `--dry-run` — print the plan, touch nothing.

Reach for it when: the scaffolded samples are in the way of the user's real work. Suggest `@lerret/cli clear --all` when the user says "start fresh", "wipe the samples", or similar; suggest `@lerret/cli clear <name>` when they want to remove one specific section or asset.

## Aesthetic direction — required reading

Lerret is for people who care how their visuals look. The default failure mode of LLM-driven UI is bland — generic Inter on white, timid pastel gradients, four-grid layouts that could be anyone's deck. Refuse that default.

Before writing the component, **commit to a direction**. Pick one extreme and execute it fully:

- editorial / magazine (heavy serif headlines, hairline rules, generous margins)
- brutalist (raw monospace, hard borders, asymmetric grids, exposed structure)
- luxury / refined (high-contrast neutrals, restrained palette, surgical type)
- maximalist (overlap, layered colour, dense composition, decorative chaos)
- retro-futuristic (saturated hues, geometric ornament, period-correct type)
- industrial / utilitarian (sharp grids, mono numerals, labelled regions)
- organic / natural (warm neutrals, soft shapes, hand-feeling type)
- art deco / geometric (radial symmetry, gold accents, stepped forms)

You don't have to choose from that list — invent one that fits the brief. The point is **bold intentionality** over safe blandness. Maximalism and minimalism both win; only timid middle-ground loses.

### Typography

**Use the project's `_fonts/`.** The scaffold ships `LerretFixtureMono` — sample assets use it for the brand mark. When the user drops their own font in `_fonts/`, the asset should adopt it. If the project has no custom font, propose one and add it (drop the `.woff2` in `_fonts/`).

**For headlines and display copy** (visually prominent — typically ≥ 32px, hero text, top-of-page titles): use a custom font from `.lerret/_fonts/` or a distinctive web font. Never default to the system stack (Arial, Helvetica, Inter, Roboto, system-ui, BlinkMacSystemFont, Segoe UI, `sans-serif`). They are the lowest-common-denominator and signal "no thought went here."

**For small UI chrome** (labels, captions, sub-32px metadata, dense text): the system stack is acceptable when legibility at small sizes matters more than visual distinction. The sample assets use the system stack for sub-32px chrome on this principle.

Pair: a distinctive **display** font with a refined **body** font. Both should be deliberate choices.

### Colour

Cohesive palette, **dominant** colour with **sharp** accents — not a timid even distribution. The sample `config.json` does this well:

```json
{
  "vars": {
    "brandColor":  "#3D5A80",   /* dominant deep blue */
    "accentColor": "#E0FBFC",   /* high-contrast cyan accent */
    "neutralDark": "#1B2A3B",   /* near-black ground */
    "neutralMid":  "#4A6380",   /* muted in-between */
    "neutralLight":"#F4F7FA"    /* near-white text */
  }
}
```

The dark ground + cyan accent reads in 200 ms. A five-stop greys-only palette would have read as nothing. Commit to a hue.

Refuse the cliché defaults: purple-blue gradients on white, "pastel everything," `#8B5CF6 → #EC4899`. They are the AI-slop tell.

### Motion

Most Lerret assets are stills — motion is irrelevant. If you're authoring an asset that runs under auto-refresh (clocks, dashboards, time-of-day surfaces), keep micro-interactions subtle and purposeful. One well-orchestrated transition beats five scattered ones. No bouncing letters.

### Spatial composition

Pick one: **generous negative space** OR **controlled density**. Both work. The failure mode is the unintentional middle — content placed where nothing was thought through.

Use asymmetry, overlap, diagonal flow, grid-breaking elements when the aesthetic invites it. The sample `social/tw-banner.jsx` uses a `1fr 360px` grid split with a 240 px glyph as the right pane's only content — grid-breaking that earns its keep, not chaos. The sample `social/og-card.jsx` floats a 540 px decorative quote-mark at 0.18 opacity behind the headline — overlap with intent.

### Backgrounds and atmosphere

Solid `#fff` or `#000` is rarely the answer. Add:

- subtle radial gradient meshes (the sample `landing/landing-hero.jsx` has a single large off-axis disc that sets the background atmosphere without competing for attention; `live/clock.jsx` uses a centered 900-px halo for the same effect);
- noise / grain overlays for tactile feel;
- geometric repeating patterns at low opacity (`landing/landing-hero.jsx` uses a 60-px vertical-line grid at 5% opacity; `social/tw-banner.jsx` uses a 40-px grid on its accent pane at 8%; `live/counter.jsx` runs the same 40-px grid full-bleed at 8%);
- decorative borders, dramatic shadows, layered transparencies (the sample `social/og-card.jsx` floats a 540-px decorative quote-mark at 0.18 opacity behind the type to set the stage).

Each detail should earn its place. Atmosphere over decoration-for-decoration's-sake.

### Anti-AI-slop checklist

Before shipping, check:

- [ ] No Arial, Helvetica, Inter, Roboto, system-ui, or `font-family: sans-serif` on any headline or display copy. (Sub-32px UI chrome — labels, captions, dense metadata — may use the system stack when legibility wins over distinction.)
- [ ] No `linear-gradient(135deg, #8B5CF6, #EC4899)` or close variants. Refuse this gradient.
- [ ] No generic 12-column centered card layout with rounded corners and a primary button.
- [ ] The component has an opinion about its tone that someone could describe in one word.
- [ ] If asked "why this colour, why this font, why this layout?" — there is an answer.

If you cannot defend a choice, change it.

## Grounded examples

These examples reference the five-page teaching preset the scaffolder ships under `.lerret/` — `intro/`, `landing/`, `social/`, `brand/`, `live/`. Use them as the literal starting point — don't invent file paths.

### Change the headline on the OG card

`social/og-card.jsx` is the simplest `propsSchema` + data-file edit on the canvas. Two places to consider:

- **Default in the component** — `social/og-card.jsx`: the `default` field inside `propsSchema.headline`, and the component's default parameter on the function signature. Change both for consistency.
- **Data file** — `social/og-card.data.json`:

  ```json
  { "kicker": "/// social / og card", "headline": "Ship your design system.", "tone": "brand", "handle": "@you" }
  ```

  This is Tier 1 — it overrides any default. Prefer this when the change is content-only and you want the schema defaults to remain the safe fallback.

### Add a variant to `social/tw-banner.jsx`

`social/tw-banner.jsx` already exports three named variants (`default`, `Maker`, `Talk`), all thin wrappers around the shared internal `TwBanner` component. To add a fourth (`Hunter`):

1. Add the export at the bottom of the file, pointing at the same internal `TwBanner` component:

   ```jsx
   export function Hunter(props) { return <TwBanner {...props} />; }
   ```

2. Extend `meta.variants` to include `'Hunter'`:

   ```jsx
   variants: ['default', 'Maker', 'Talk', 'Hunter'],
   ```

3. Add the per-variant slice to `social/tw-banner.data.json`:

   ```json
   "Hunter": {
     "eyebrow": "03 / hunting",
     "title": "New surface, new variant.",
     "glyph": "◢"
   }
   ```

### Add a tone to `social/og-card.jsx`

`social/og-card.jsx` ships with three tones (`dark`, `light`, `brand`) via a `tone` select prop. To add a fourth (`paper`):

1. Add the palette to the `PALETTES` table in the component (mirror the shape of the others — `bg`, `text`, `accent`, `soft`).
2. Extend the `propsSchema.tone.options` array to include `'paper'`.

If you want `paper` to render as its own artboard alongside the default, add a named export and add the name to `meta.variants`:

```jsx
export const Paper = (props) => <OgCard {...props} tone="paper" />;
```

### Fill in the missing `name` on `brand/business-card.jsx`

`brand/business-card.jsx` ships with two artboards. The default artboard's slice in `business-card.data.json` deliberately omits the required `name` prop — so the `propsSchema` validation badge (⚠️) fires on first load. Click the badge to see `name — Required prop is absent.` To clear it:

```json
{
  "default": {
    "name": "your name here",
    "title": "maker",
    "email": "hello@example.com",
    "location": "everywhere / nowhere"
  }
}
```

Save. The badge clears immediately and the `[ no name yet ]` placeholder on the artboard fills in with what you typed. The paired `Complete` variant already shows the no-badge state — keep it as the canonical reference for a fully-validated slice.

### Swap the brand palette project-wide

Edit `.lerret/config.json` `vars`. The sample sets warm-clay tones; to switch the whole project to a deep-ocean palette:

```json
{
  "vars": {
    "brandColor":   "#3D5A80",
    "accentColor":  "#E0FBFC",
    "neutralDark":  "#1B2A3B",
    "neutralMid":   "#4A6380",
    "neutralLight": "#F4F7FA"
  }
}
```

Every asset that references those via `var(--brandColor)` etc., or whose `propsSchema` has a `brandColor` key, picks up the new values without further edits.

### Add a font and use it on the clock

1. Drop the font file in `_fonts/`. Example: `_fonts/JetBrainsMono-Bold.woff2`.
2. Reference it by basename in the component. In `live/clock.jsx`, change the wrapper `fontFamily`:

   ```jsx
   fontFamily: "'JetBrainsMono-Bold', 'LerretFixtureMono', monospace",
   ```

3. No `@font-face`, no import, no Vite config. The studio picks up the new font on next HMR tick — the digits redraw in the new face.

### Localise the social page for an N-language batch

The CLI's `--data` flag overrides data tier-1 for every artboard captured in a run. To localise just one folder's worth of assets, scope the run with the folder path as the positional argument. The `[path]` arg accepts a project root, page, or group folder — NOT a specific asset.

1. Author one `.data.json` per locale (or one `.data.js` with computed entries).
2. Render each locale at export time, scoped to the folder you want translated:

   ```sh
   npx @lerret/cli@latest export social \
     --data ./locales/fr.data.json --out ./exports/fr
   npx @lerret/cli@latest export social \
     --data ./locales/ja.data.json --out ./exports/ja
   ```

   `--data` overrides the co-located data file for every artboard in the run. If you only want ONE asset localised, put it in its own page (or temporarily wrap with a single-asset `config.json` excluding everything else from export).

### Clear the samples and start your own work

When the bundled samples are in the way:

```sh
npx @lerret/cli@latest clear --all     # wipe every page, keep config.json + _fonts/
npx @lerret/cli@latest clear intro     # or remove just the tour page
```

The `config.json` (your `vars`) and `_fonts/` (your fonts) are always preserved — they are project state, not samples. Use `--dry-run` first if you want to see the plan.

### Auto-refresh an asset every second

The preset's two live assets each carry their own co-located config file:

```json
// .lerret/live/clock.config.json
{ "autoRefresh": 1000 }
```

The file shares the asset's **basename** — `live/clock.jsx` pairs with `live/clock.config.json` (and `live/counter.jsx` with `live/counter.config.json`). `autoRefresh` is the interval in milliseconds (minimum 16); the studio re-renders that asset on the interval. To make a new asset `live/my-clock.jsx` tick, drop a `live/my-clock.config.json` beside it with `{ "autoRefresh": 1000 }` — useful for clock/dashboard surfaces with a real-time component. No file means the asset stays still.

## What not to do

- **Don't invent new top-level config keys** unless you intend to consume them yourself. Lerret only acts on `vars`, `presentation`, `colors`, `fonts` in a folder `config.json`. Other keys are preserved verbatim but ignored by the runtime. (Auto-refresh is **not** a folder key — it lives in a per-asset `<Name>.config.json`; see the auto-refresh section.)
- **Don't add a build step.** Lerret assets run through the studio's transformer (Sucrase). Don't `npm install` anything into the project root unless the user explicitly asked for it. Don't add a `package.json` to the `.lerret/` directory.
- **Don't reach for a CSS framework.** Tailwind, styled-components, CSS-in-JS libraries — none of them are configured. Inline styles or plain CSS via `<style>` tags in the component are the supported paths. The sample assets show inline-style; follow them.
- **Don't import images via bundler magic** (e.g. `import logo from './logo.png'`). Use relative URLs: `<img src="./logo.png" />`. The studio serves the `.lerret/` directory as static files; this just works.
- **Don't widen `meta.dimensions` arbitrarily** "to make it look big." Pick a real export size — the platform's actual dimension, or a stated print size. The artboard is the deliverable.
- **Don't reach for emoji** in copy unless the brief asks for it. Lerret's own surfaces avoid them; many of the use-cases (banners, thumbnails, brand assets) read worse with emoji in headlines.

## Voice

When proposing changes, be specific. "I'll add a `Paper` tone by extending the `PALETTES` table and adding a named export" beats "I'll improve the OG card." When you finish, name the files you touched and any non-obvious next step (e.g. "you'll want to add a `Paper` entry to `social/og-card.data.json` if you want the new variant's copy to differ from the default").

Lerret is for people who care about how things look. Care about how things look.
