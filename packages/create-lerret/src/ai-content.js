// Shared content source for Lerret's AI-tool integrations.
//
// `create-lerret` emits Lerret-authoring guidance into four AI-tool surfaces:
//
//   - `.claude/skills/lerret-author/SKILL.md`  (Claude Code, frontmatter-driven skill)
//   - `.claude/commands/lerret-edit.md`        (Claude Code, `/lerret-edit` command)
//   - `.cursor/rules/lerret.mdc`               (Cursor, MDC = MD + YAML frontmatter)
//   - `.github/copilot-instructions.md`        (GitHub Copilot custom instructions)
//   - `AGENTS.md`                              (cross-tool standard — Codex, Antigravity, Aider, Cline, …)
//
// The Lerret-conventions prose is authored **once** in `SECTIONS` below, then
// composed per tool by the `render*` functions. Every CLI reference goes
// through `CLI` constants — the canonical `@lerret/cli <cmd>` form (or its
// zero-install variants). The bare `lerret <cmd>` form is FORBIDDEN: it
// resolves to an unrelated deprecated npm package owned by user `jgrh`. See
// `_bmad-output/planning-artifacts/adr-002-cli-package-naming.md`.
//
// Tests in `create-lerret.test.js` mechanically grep every emitted file for
// the forbidden pattern; this module is the single chokepoint for enforcement.

// ---------------------------------------------------------------------------
// Canonical CLI strings — never use the bare `lerret <cmd>` form anywhere.
// ---------------------------------------------------------------------------

export const CLI = {
  pkg: '@lerret/cli',
  dev: '@lerret/cli dev',
  exportCmd: '@lerret/cli export',
  npxDev: 'npx @lerret/cli@latest dev',
  npxExport: 'npx @lerret/cli@latest export',
  pnpmDlxDev: 'pnpm dlx @lerret/cli@latest dev',
  yarnDlxDev: 'yarn dlx @lerret/cli@latest dev',
  bunxDev: 'bunx @lerret/cli@latest dev',
  scaffolder: 'create-lerret',
  npxScaffolder: 'npx create-lerret@latest',
};

// ---------------------------------------------------------------------------
// Structured content — the single source of truth.
// ---------------------------------------------------------------------------
//
// Each field is a chunk of authoring prose. Renderers compose subsets per tool
// and prepend tool-specific framing (frontmatter, header, tone) on top.

export const SECTIONS = {
  // Short skill description used in Claude's YAML frontmatter (one line).
  claudeSkillDescription:
    'Author and edit visual assets inside a Lerret project. Use whenever you create, modify, or refactor a `.jsx`/`.tsx` file under a `.lerret/` directory, change `config.json`, or work with `.data.json`/`.data.js`, `_fonts/`, or `assets/` files in that tree. Covers Lerret\'s conventions (meta export, propsSchema, variants, four-tier prop resolution, cascading config, auto-registered fonts, ambient CSS vars) and the `@lerret/cli` surface (`create-lerret`, `dev`, `export`). Bakes in aesthetic direction so generated visuals are distinctive, cohesive, and production-grade — not generic AI output.',

  // Short Cursor description (used in MDC frontmatter).
  cursorDescription: 'Lerret asset authoring conventions',

  // Intro paragraph that opens the body of every tool's file.
  intro: `You are editing inside a Lerret project. Lerret is a folder-of-React-files design canvas: every \`.jsx\` or \`.tsx\` file under \`.lerret/\` is a visual asset that renders on the canvas. There is no UI framework to fight, no design system to inherit — only React, the conventions below, and the aesthetic bar.

This guidance exists for two reasons:

1. Get the **mechanics** right the first time. Lerret's conventions compose standard React with a small set of Lerret-specific contracts (\`meta\`, cascading \`config.json\`, co-located data files, auto-registered fonts). If you miss them, the asset breaks or its props don't resolve.
2. Get the **aesthetic** right the first time. The default failure mode of LLM-generated UI is timid, generic, purple-gradient slop. Lerret is for people who care about how their visuals look — match that bar.`,

  projectLayout: `## Project layout

A Lerret project is a folder called \`.lerret/\`. Anything inside it is part of the canvas.

\`\`\`
.lerret/
  config.json                    # Root config — vars, presentation, liveRefresh
  _fonts/                        # Drop .woff2/.woff/.ttf/.otf here — auto-registered
    LerretFixtureMono.woff2
  social/                        # A folder = a section/page on the canvas
    twitter-banner.jsx           # Asset (default-export React component)
    twitter-banner.data.json     # Co-located data for that asset (optional)
    youtube-thumbnail.jsx
    instagram-square.jsx
  brand/
    config.json                  # Per-folder config — inherits from parent
    Logo.jsx
    Logo-mark.svg                # Component-prefixed image (see below)
    Logo-bg.png
\`\`\`

Folders nest as deep as you want. Each folder becomes a section on the canvas.`,

  assetContract: `## The asset contract

Every asset is a \`.jsx\` or \`.tsx\` file with **one default export** — a React component that renders the artboard's full surface. Use \`width: '100%'; height: '100%'\` on the outer wrapper; Lerret sizes the artboard from \`meta.dimensions\`.

Optional named export \`meta\` declares artboard metadata:

\`\`\`jsx
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
\`\`\`

The \`meta\` export is **optional**. An asset without it still renders; the canvas falls back to a default artboard size. Add \`meta\` when you need a specific export size, a nicer label, or \`propsSchema\`-driven knobs.

The field is \`dimensions\`. Not \`exportDimensions\`, not \`size\`, not \`width\`/\`height\` at the top level.`,

  variants: `## Variants — additional named exports

Beyond \`default\`, every additional named export is a **variant** of the asset. Each variant renders as its own artboard.

\`\`\`jsx
export default function Card({ title }) { /* … */ }
export const Dark = (props) => <Card {...props} theme="dark" />;
export const Wide = (props) => <Card {...props} layout="wide" />;
\`\`\`

To feed each variant its own data, use a keyed \`.data.json\`:

\`\`\`json
{
  "default": { "title": "Default card" },
  "Dark":    { "title": "Dark card" },
  "Wide":    { "title": "Wide card" }
}
\`\`\`

(A flat shared-data object — without per-variant keys — applies to every variant.)`,

  dataFiles: `## Co-located data files

Two filenames are recognised next to an asset:

- \`<AssetName>.data.json\` — static data, parsed as JSON.
- \`<AssetName>.data.js\` — dynamic data, default-export an object (or a function returning one).

When **both** exist, \`.data.js\` wins. Most assets need only \`.data.json\`.

The data file shares the asset's basename — \`twitter-banner.jsx\` pairs with \`twitter-banner.data.json\`. Co-location is strict: the data file must be in the same folder as the asset.`,

  propResolution: `## Four-tier prop resolution

Every prop the component receives is resolved in this fixed order. First tier that supplies the prop wins. Per-prop independence — different props can come from different tiers in the same render.

1. **Data** — the matching value from \`<AssetName>.data.json\` / \`.data.js\` (per-variant key when variants exist, otherwise the shared object).
2. **Vars** — the cascaded \`vars\` block from the asset's folder's effective \`config.json\`. Use for project-wide tokens (brand colours, accent colours) that you want available without repeating them per asset.
3. **propsSchema default** — the \`default\` field inside each prop's schema descriptor.
4. **Component default** — React's own default parameter (\`function Foo({ x = 'fallback' }) {}\`).

If you change a prop's default in \`propsSchema\`, you don't also need to change the component's default parameter — but keep them in sync for code that's read without running.`,

  cascadingConfig: `## Cascading \`config.json\`

Every folder may contain a \`config.json\`. Child configs **shallow-merge over** parent configs by top-level key. Known keys:

- \`vars\` — object of string/number tokens. Available as ambient CSS custom properties (\`var(--brandColor)\` etc.) on the wrapper around your component, and as Tier-2 props on \`propsSchema\` keys with matching names.
- \`presentation\` — canvas presentation, e.g. \`{ background: '#f0e8d8' }\` paints this folder's section.
- \`liveRefresh\` — \`{ <AssetName>: <interval-ms> }\`. Re-renders the named asset on the timer (minimum 16 ms). Useful for clock/timer/time-of-day assets.
- \`colors\`, \`fonts\` — design tokens (free-form objects, kept for future tooling; safe to use today).

Example root config:

\`\`\`json
{
  "vars": {
    "brandColor": "#3D5A80",
    "accentColor": "#E0FBFC",
    "neutralDark": "#1B2A3B",
    "neutralLight": "#F4F7FA"
  }
}
\`\`\`

In an asset under that folder you can write \`style={{ color: 'var(--accentColor)' }}\` or simply destructure a \`brandColor\` prop if your \`propsSchema\` declares one — Tier 2 will fill it from \`vars\`.

A folder-level config overrides the parent on a per-top-level-key basis. Setting \`vars\` in a child **replaces** the parent's \`vars\` entirely (no deep merge). If you want to extend rather than replace, repeat the parent keys you care about.`,

  fonts: `## Fonts — drop a file, use it

Put any \`.woff2\`, \`.woff\`, \`.ttf\`, or \`.otf\` in \`.lerret/_fonts/\`. Lerret generates an \`@font-face\` rule using the file's basename as the \`font-family\` — zero imports, zero \`@font-face\` boilerplate.

\`.lerret/_fonts/LerretFixtureMono.woff2\` becomes:

\`\`\`jsx
<div style={{ fontFamily: "'LerretFixtureMono', monospace" }}>lerret</div>
\`\`\`

Quote the family name in inline styles when it contains capital letters or hyphens. Always declare a fallback (\`monospace\`, \`serif\`, \`sans-serif\`) for the few hundred milliseconds before the woff loads — never let the fallback be Arial or Inter (see the aesthetic section).`,

  imageNaming: `## Image and asset files

Two rules — apply them by default.

**Rule 1 — component-prefixed, co-located.** When an image is *for* one component, put it in the same folder as the component and prefix its filename with the component's name:

\`\`\`
social/
  Twitter.jsx
  Twitter-logo.png         # used by Twitter.jsx
  Twitter-bg.jpg
  Twitter-avatar.png
  Youtube.jsx
  Youtube-thumbnail.jpg
\`\`\`

The pattern is \`<ComponentName>-<purpose>.<ext>\`. This makes it trivial to:

- scan a folder and see which files belong to which component;
- delete a component + its resources atomically;
- predict where an AI edit will write new images.

Reference these as relative URLs from the component:

\`\`\`jsx
<img src="./Twitter-logo.png" alt="" />
\`\`\`

**Rule 2 — shared assets get a descriptive name in \`assets/\`.** When an image is reused across components, put it in an \`assets/\` directory (at the project root or at the relevant folder level) and give it a plain descriptive name — no component prefix needed:

\`\`\`
assets/
  brand-logo.svg
  photo-placeholder.jpg
.lerret/
  social/
    Twitter.jsx          # uses ../../assets/brand-logo.svg
    Instagram.jsx        # also uses ../../assets/brand-logo.svg
\`\`\`

If you're not sure whether something is shared, prefix it. Renaming later is cheap; untangling co-mingled shared assets later is not.`,

  cliSurface: `## The \`${CLI.pkg}\` surface

Three commands. All three are zero-install: \`npx ${CLI.pkg}@latest <cmd>\`, \`pnpm dlx ${CLI.pkg}@latest <cmd>\`, \`yarn dlx ${CLI.pkg}@latest <cmd>\`, \`bunx ${CLI.pkg}@latest <cmd>\`.

### \`${CLI.scaffolder} <name> [--no-samples] [--no-ai-rules] [--ai-tools=...]\`

Scaffolds a new project. Defaults to copying the sample template (this guidance is part of that scaffold). \`--no-samples\` produces an empty project — just \`.lerret/config.json\` with \`{ "vars": {} }\` — no \`_fonts/\`, no sample assets. \`--no-ai-rules\` skips emitting AI-tool integration files; \`--ai-tools=claude,cursor,copilot,agents\` scopes which ones ship.

Reach for it when: starting a new project. That's it.

### \`${CLI.dev} [--port <n>] [--folder <path>] [--open | --no-open]\`

Starts the studio against the nearest \`.lerret/\` folder with HMR. Edits to assets, data files, and config show up live.

- \`--port\` — pick a port (default Vite chooses).
- \`--folder\` — point at a specific \`.lerret/\` if there are several or yours isn't on the cwd path.
- \`--open\` / \`--no-open\` — auto-open the browser (or don't).

Reach for it when: you're authoring. This is the loop you live in.

### \`${CLI.exportCmd} [path] [--format png|jpg] [--out <dir>] [--flat] [--data <file>] [--config <file>]\`

Headlessly renders artboards to image files. Output mirrors the folder tree by default.

- \`[path]\` — restrict to one folder, one asset, or one variant. Omit to export everything.
- \`--format\` — \`png\` (default) or \`jpg\`.
- \`--out\` — destination directory (default: \`./exports\`).
- \`--flat\` — flatten the output instead of mirroring folders.
- \`--data\` — substitute a data file for one asset/variant at export time. Useful for batch generation (one component, N data files).
- \`--config\` — substitute a config file for the run. Useful for re-skinning the whole project (e.g. swap \`vars\` to render light + dark variants of every asset).

Reach for it when: shipping the actual images. CI-friendly — exit code 0 on success.`,

  aestheticIntro: `## Aesthetic direction — required reading

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

You don't have to choose from that list — invent one that fits the brief. The point is **bold intentionality** over safe blandness. Maximalism and minimalism both win; only timid middle-ground loses.`,

  aestheticTypography: `### Typography

**Use the project's \`_fonts/\`.** The scaffold ships \`LerretFixtureMono\` — sample assets use it for the brand mark. When the user drops their own font in \`_fonts/\`, the asset should adopt it. If the project has no custom font, propose one and add it (drop the \`.woff2\` in \`_fonts/\`).

**For headlines and display copy** (visually prominent — typically ≥ 32px, hero text, top-of-page titles): use a custom font from \`.lerret/_fonts/\` or a distinctive web font. Never default to the system stack (Arial, Helvetica, Inter, Roboto, system-ui, BlinkMacSystemFont, Segoe UI, \`sans-serif\`). They are the lowest-common-denominator and signal "no thought went here."

**For small UI chrome** (labels, captions, sub-32px metadata, dense text): the system stack is acceptable when legibility at small sizes matters more than visual distinction. The sample assets use the system stack for sub-32px chrome on this principle.

Pair: a distinctive **display** font with a refined **body** font. Both should be deliberate choices.`,

  aestheticColour: `### Colour

Cohesive palette, **dominant** colour with **sharp** accents — not a timid even distribution. The sample \`config.json\` does this well:

\`\`\`json
{
  "vars": {
    "brandColor":  "#3D5A80",   /* dominant deep blue */
    "accentColor": "#E0FBFC",   /* high-contrast cyan accent */
    "neutralDark": "#1B2A3B",   /* near-black ground */
    "neutralMid":  "#4A6380",   /* muted in-between */
    "neutralLight":"#F4F7FA"    /* near-white text */
  }
}
\`\`\`

The dark ground + cyan accent reads in 200 ms. A five-stop greys-only palette would have read as nothing. Commit to a hue.

Refuse the cliché defaults: purple-blue gradients on white, "pastel everything," \`#8B5CF6 → #EC4899\`. They are the AI-slop tell.`,

  aestheticMotion: `### Motion

Most Lerret assets are stills — motion is irrelevant. If you're authoring an asset that runs under \`liveRefresh\` (clocks, dashboards, time-of-day surfaces), keep micro-interactions subtle and purposeful. One well-orchestrated transition beats five scattered ones. No bouncing letters.`,

  aestheticComposition: `### Spatial composition

Pick one: **generous negative space** OR **controlled density**. Both work. The failure mode is the unintentional middle — content placed where nothing was thought through.

Use asymmetry, overlap, diagonal flow, grid-breaking elements when the aesthetic invites it. The sample \`youtube-thumbnail.jsx\` uses an off-axis skewed panel split and a giant low-opacity glyph in the right pane — that's grid-breaking that earns its keep, not chaos.`,

  aestheticBackground: `### Backgrounds and atmosphere

Solid \`#fff\` or \`#000\` is rarely the answer. Add:

- subtle radial gradient meshes (the sample \`twitter-banner.jsx\` has two layered radial-gradient ellipses for depth);
- noise / grain overlays for tactile feel;
- geometric repeating patterns at low opacity (the sample \`youtube-thumbnail.jsx\` uses a 40-px grid overlay at 4% opacity on the right panel);
- decorative borders, dramatic shadows, layered transparencies.

Each detail should earn its place. Atmosphere over decoration-for-decoration's-sake.`,

  antiSlop: `### Anti-AI-slop checklist

Before shipping, check:

- [ ] No Arial, Helvetica, Inter, Roboto, system-ui, or \`font-family: sans-serif\` on any headline or display copy. (Sub-32px UI chrome — labels, captions, dense metadata — may use the system stack when legibility wins over distinction.)
- [ ] No \`linear-gradient(135deg, #8B5CF6, #EC4899)\` or close variants. Refuse this gradient.
- [ ] No generic 12-column centered card layout with rounded corners and a primary button.
- [ ] The component has an opinion about its tone that someone could describe in one word.
- [ ] If asked "why this colour, why this font, why this layout?" — there is an answer.

If you cannot defend a choice, change it.`,

  examples: `## Grounded examples

These examples reference the sample assets the scaffolder ships at \`.lerret/social/\`. Use them as the literal starting point — don't invent file paths.

### Change the headline on the Twitter banner

The simplest edit. Two places to consider:

- **Default in the component** — \`twitter-banner.jsx\`: the \`default\` field inside \`propsSchema.headline\`, and the component's default parameter on the function signature. Change both for consistency.
- **Data file** — \`twitter-banner.data.json\`:

  \`\`\`json
  { "headline": "Ship your design system", "showAccentBar": true, "tagline": "…" }
  \`\`\`

  This is Tier 1 — it overrides any default. Prefer this when the change is content-only and you want the schema defaults to remain the safe fallback.

### Add a variant to \`instagram-square.jsx\`

\`instagram-square.jsx\` already supports three tones via a \`tone\` select prop. To add a fourth (\`dusk\`):

1. Add the palette to the \`TONES\` table in the component:

   \`\`\`jsx
   dusk: {
     bg: 'linear-gradient(145deg, #2D1B3D 0%, #5C3B6E 100%)',
     title: '#F4E4F7', subtitle: '#C19BCE',
     tag: '#7D4F8C', tagText: '#F4E4F7', mono: '#A878B8',
   },
   \`\`\`

2. Extend the \`propsSchema.tone.options\` array to include \`'dusk'\`.

If you want \`dusk\` to render as its own artboard alongside \`ocean\`, add a named export at the bottom of the file:

\`\`\`jsx
export const Dusk = (props) => <InstagramSquare {...props} tone="dusk" />;
\`\`\`

Then in \`instagram-square.data.json\` (create the file if missing), key per variant:

\`\`\`json
{
  "default": { "title": "…", "subtitle": "…", "tone": "ocean" },
  "Dusk":    { "title": "After hours",  "subtitle": "Late nights, deep colour." }
}
\`\`\`

### Swap the brand palette project-wide

Edit \`.lerret/config.json\` \`vars\`. The sample sets ocean blues; to switch the whole project to a warm-paper palette:

\`\`\`json
{
  "vars": {
    "brandColor":   "#8B5A2B",
    "accentColor":  "#FFE5B4",
    "neutralDark":  "#2C1810",
    "neutralMid":   "#7D6450",
    "neutralLight": "#F5EFE0"
  }
}
\`\`\`

Every asset that references those via \`var(--brandColor)\` etc., or whose \`propsSchema\` has a \`brandColor\` key, picks up the new values without further edits.

### Add a font and use it on the YouTube thumbnail

1. Drop the font file in \`_fonts/\`. Example: \`_fonts/Editorial-Display.woff2\`.
2. Reference it by basename in the component. In \`youtube-thumbnail.jsx\`, change the \`fontFamily\` on the main-title block:

   \`\`\`jsx
   fontFamily: "'Editorial-Display', Georgia, serif",
   \`\`\`

3. No \`@font-face\`, no import, no Vite config. The studio picks up the new font on next HMR tick.

### Localise the YouTube thumbnail for an N-language batch

1. Author one \`.data.js\` per locale, OR a single data file with computed entries:

   \`\`\`js
   // youtube-thumbnail.data.js
   export default {
     title: 'Comment Lerret a été construit',
     episodeLabel: 'EP 01',
     showBrand: true,
   };
   \`\`\`

2. Render each locale at export time without touching the component:

   \`\`\`sh
   ${CLI.npxExport} social/youtube-thumbnail \\
     --data ./locales/fr.data.json --out ./exports/fr
   ${CLI.npxExport} social/youtube-thumbnail \\
     --data ./locales/ja.data.json --out ./exports/ja
   \`\`\`

   \`--data\` overrides the co-located data file for the run only.

### Live-update an asset every second

Add to \`.lerret/config.json\` (or any folder-level \`config.json\`):

\`\`\`json
{
  "vars": { /* … */ },
  "liveRefresh": { "Clock": 1000 }
}
\`\`\`

The key is the asset's exported component name (the basename of the file without \`.jsx\`). The value is the interval in milliseconds (minimum 16). The studio re-renders the named asset on that interval — useful for clock/dashboard surfaces with a real-time component.`,

  notDo: `## What not to do

- **Don't invent new top-level config keys** unless you intend to consume them yourself. Lerret only acts on \`vars\`, \`presentation\`, \`liveRefresh\`, \`colors\`, \`fonts\`. Other keys are preserved verbatim but ignored by the runtime.
- **Don't add a build step.** Lerret assets run through the studio's transformer (Sucrase). Don't \`npm install\` anything into the project root unless the user explicitly asked for it. Don't add a \`package.json\` to the \`.lerret/\` directory.
- **Don't reach for a CSS framework.** Tailwind, styled-components, CSS-in-JS libraries — none of them are configured. Inline styles or plain CSS via \`<style>\` tags in the component are the supported paths. The sample assets show inline-style; follow them.
- **Don't import images via bundler magic** (e.g. \`import logo from './logo.png'\`). Use relative URLs: \`<img src="./logo.png" />\`. The studio serves the \`.lerret/\` directory as static files; this just works.
- **Don't widen \`meta.dimensions\` arbitrarily** "to make it look big." Pick a real export size — the platform's actual dimension, or a stated print size. The artboard is the deliverable.
- **Don't reach for emoji** in copy unless the brief asks for it. Lerret's own surfaces avoid them; many of the use-cases (banners, thumbnails, brand assets) read worse with emoji in headlines.`,

  voice: `## Voice

When proposing changes, be specific. "I'll add a \`Dusk\` variant by extending the \`TONES\` table and adding a named export" beats "I'll improve the Instagram square." When you finish, name the files you touched and any non-obvious next step (e.g. "you'll want to add \`instagram-square.data.json\` to override the new variant's default subtitle").

Lerret is for people who care about how things look. Care about how things look.`,
};

// ---------------------------------------------------------------------------
// Renderers — compose SECTIONS into per-tool file contents.
// ---------------------------------------------------------------------------
//
// Each renderer returns the FULL file content (trailing newline included).
// The shape of frontmatter / framing differs per tool but the body content is
// composed from the same SECTIONS.

/**
 * Compose the shared body that every tool's file includes.
 *
 * @returns {string}
 */
function sharedBody() {
  return [
    SECTIONS.intro,
    SECTIONS.projectLayout,
    SECTIONS.assetContract,
    SECTIONS.variants,
    SECTIONS.dataFiles,
    SECTIONS.propResolution,
    SECTIONS.cascadingConfig,
    SECTIONS.fonts,
    SECTIONS.imageNaming,
    SECTIONS.cliSurface,
    SECTIONS.aestheticIntro,
    SECTIONS.aestheticTypography,
    SECTIONS.aestheticColour,
    SECTIONS.aestheticMotion,
    SECTIONS.aestheticComposition,
    SECTIONS.aestheticBackground,
    SECTIONS.antiSlop,
    SECTIONS.examples,
    SECTIONS.notDo,
    SECTIONS.voice,
  ].join('\n\n');
}

/**
 * Render the Claude `lerret-author` skill — markdown with YAML frontmatter.
 * Claude's skill matcher reads the `name` and `description` fields.
 *
 * @returns {string}
 */
export function renderClaudeSkill() {
  const frontmatter = [
    '---',
    'name: lerret-author',
    `description: ${SECTIONS.claudeSkillDescription}`,
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${sharedBody()}\n`;
}

/**
 * Render the `/lerret-edit` Claude command file. Short — its purpose is to
 * dispatch into the `lerret-author` skill with the user's intent forwarded
 * verbatim.
 *
 * @returns {string}
 */
export function renderClaudeCommand() {
  return `---
description: Edit a Lerret asset (or scaffold a new one) under .lerret/ with the lerret-author skill loaded.
---

You are editing a Lerret project. The asset root is \`.lerret/\` at the workspace root (or the nearest \`.lerret/\` to the file the user named).

Use the \`lerret-author\` skill — it covers Lerret's conventions (the \`meta\` export with \`dimensions\`/\`label\`/\`tags\`/\`propsSchema\`, variants via additional named exports, the four-tier prop resolution chain, cascading \`config.json\` with \`vars\`/\`presentation\`/\`liveRefresh\`, auto-registered \`_fonts/\`, co-located \`<name>.data.json\`/\`.data.js\`, component-prefixed image naming) AND the aesthetic bar Lerret expects (commit to a bold direction, distinctive typography from \`_fonts/\`, cohesive dominant-with-accents palette, no Arial/Inter/Roboto on headlines, no purple-gradient slop).

For top-tier visual output, the user can optionally install Anthropic's official \`frontend-design\` plugin — it goes deeper on production-grade frontend aesthetics. It's complementary to \`lerret-author\`, not a replacement. Install (one-time, not required for this command to work):

\`\`\`
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design@claude-plugins-official
\`\`\`

Now act on the user's intent below. Read the existing asset (if any) first, ground every change in the real files under \`.lerret/\`, and follow the conventions in \`lerret-author\`.

User intent: $ARGUMENTS
`;
}

/**
 * Render the Cursor `.cursor/rules/lerret.mdc` file — MDC = MD + YAML
 * frontmatter. `alwaysApply: true` so the rule loads for every conversation
 * in the project; the `globs` narrow it to Lerret-relevant files for
 * documentation purposes (Cursor still applies it broadly when
 * `alwaysApply` is set).
 *
 * Reference: https://docs.cursor.com/context/rules-for-ai
 *
 * @returns {string}
 */
export function renderCursorRule() {
  const frontmatter = [
    '---',
    `description: ${SECTIONS.cursorDescription}`,
    'globs:',
    '  - ".lerret/**/*.{jsx,tsx,md,json}"',
    'alwaysApply: true',
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${sharedBody()}\n`;
}

/**
 * Render the GitHub Copilot `.github/copilot-instructions.md` file.
 * Plain markdown, no frontmatter. The opening sentence orients Copilot
 * to the Lerret context.
 *
 * Reference: https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
 *
 * @returns {string}
 */
export function renderCopilotInstructions() {
  return `# Lerret asset authoring — Copilot custom instructions

These instructions apply to every Copilot suggestion in this repository.

${sharedBody()}
`;
}

/**
 * Render the cross-tool `AGENTS.md` file at the project root. Plain markdown.
 * Picked up by OpenAI Codex CLI, Google Antigravity, Aider, Cline, and other
 * AGENTS.md-aware tools.
 *
 * Structure: overview · conventions · commands · architecture pointers.
 *
 * Reference: https://agents.md/
 *
 * @returns {string}
 */
export function renderAgentsMd() {
  return `# AGENTS.md

This is a **Lerret project** — a folder-of-React-files design canvas. Every \`.jsx\` or \`.tsx\` file under \`.lerret/\` is a visual asset that renders to a canvas surface and can be exported to PNG/JPG via the CLI.

This file documents the conventions every AI agent (Codex CLI, Antigravity, Aider, Cline, and any AGENTS.md-aware tool) should follow when editing this project.

## Overview

- **Stack:** React (\`.jsx\`/\`.tsx\` only, no build step), Sucrase transform at runtime, plain inline styles or \`<style>\` tags.
- **No frameworks:** no Tailwind, no styled-components, no CSS-in-JS libraries. Inline styles or plain CSS in the component.
- **Asset root:** the \`.lerret/\` directory at the workspace root. Folders nest; each folder is a canvas section.
- **CLI:** \`${CLI.pkg}\` (see Commands below). The bare \`lerret\` package on npm is unrelated and deprecated — never use it.

## Commands

- \`${CLI.npxDev}\` — start the studio with HMR against the nearest \`.lerret/\` folder.
- \`${CLI.npxExport}\` — render artboards to PNG/JPG files (mirrors folder tree by default).
- \`${CLI.npxScaffolder} <name>\` — scaffold a new Lerret project (only for net-new projects, not relevant inside an existing one).

All three are zero-install: \`${CLI.npxDev}\`, \`${CLI.pnpmDlxDev}\`, \`${CLI.yarnDlxDev}\`, \`${CLI.bunxDev}\`.

## Verifying changes

- **Preview:** save the file; the studio HMRs automatically when \`${CLI.npxDev}\` is running.
- **Lint/typecheck:** there is no project-level lint or build — Lerret runs \`.jsx\` files via Sucrase at runtime. Asset errors surface as a per-artboard error boundary on the canvas.
- **Export check:** \`${CLI.npxExport} <path/to/asset>\` produces a PNG you can spot-check.

${sharedBody()}
`;
}

// ---------------------------------------------------------------------------
// Tool registry — drives the per-tool emit step in create-lerret.js.
// ---------------------------------------------------------------------------
//
// Adding a new tool means adding one entry here and one renderer above. The
// scaffolder reads this list, filters per --ai-tools flag, and writes each
// surface's files.

/**
 * @typedef {Object} AiToolSurface
 * @property {string} id            Lowercase identifier used by --ai-tools=...
 * @property {Array<{path: string, render: () => string}>} files  File path
 *   relative to the project root, plus a renderer that returns its content.
 */

/** @type {AiToolSurface[]} */
export const AI_TOOLS = [
  {
    id: 'claude',
    files: [
      {
        path: '.claude/skills/lerret-author/SKILL.md',
        render: renderClaudeSkill,
      },
      {
        path: '.claude/commands/lerret-edit.md',
        render: renderClaudeCommand,
      },
    ],
  },
  {
    id: 'cursor',
    files: [
      {
        path: '.cursor/rules/lerret.mdc',
        render: renderCursorRule,
      },
    ],
  },
  {
    id: 'copilot',
    files: [
      {
        path: '.github/copilot-instructions.md',
        render: renderCopilotInstructions,
      },
    ],
  },
  {
    id: 'agents',
    files: [
      {
        path: 'AGENTS.md',
        render: renderAgentsMd,
      },
    ],
  },
];

export const VALID_AI_TOOL_IDS = AI_TOOLS.map((t) => t.id);
