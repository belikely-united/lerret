# Changelog

All notable changes to Lerret are documented here. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

> Pre-1.0 versions (`0.x.y`) may include breaking changes between minor releases.

The published packages are [`@lerret/cli`](https://www.npmjs.com/package/@lerret/cli), [`@lerret/core`](https://www.npmjs.com/package/@lerret/core), and [`create-lerret`](https://www.npmjs.com/package/create-lerret). Each tracks its own SemVer; this file is the consolidated project changelog.

## [Unreleased]

### Added
- Marketing landing site scaffold (Astro 5) for `lerret.io`, hosted on Firebase. Private — lives in the maintainer workspace.
- `app/sitemap.js` and `app/robots.js` for the docs site so search crawlers (Algolia DocSearch first) can discover all pages.
- A "Community & support" channels table on the docs root.

### Changed
- **License: relicensed to MIT.** Lerret is now MIT-licensed — free to use, self-host, modify, embed, and redistribute, including in commercial and closed-source products. This reverts the brief AGPL-3.0 + commercial dual-license; the commercial license and CLA are dropped in favor of a DCO (`Signed-off-by`). The core stays fully open; the project is sustained by hosted services around it, not by the license.
- Docs content expanded from 221 → 1,556 lines across 8 pages. Every CLI flag, prop tier, config rule, and asset behavior verified against the actual source in `packages/cli` and `packages/core`.
- Nextra global footer now surfaces GitHub, Discussions, Issues, npm, X, and `lerret.io` on every page; navbar gains a Discussions link.

### Fixed
- `docsRepositoryBase` in the Nextra layout pointed at the wrong path (missing the `public/` workspace prefix), which 404'd every "Edit this page on GitHub" link.

## @lerret/cli 0.1.14 — 2026-09-21

### Fixed
- **The studio no longer logs a 404 for every artboard.** A plain page load emitted two `404`s per artboard — `<Name>.data.js` at `/@lerret-project/` and again at `/@fixture-lerret/` — before falling back to the `.data.json` that actually existed. The studio cannot stat the filesystem, so it discovered an asset's co-located data file empirically: import the higher-precedence `.data.js` (FR22) and treat a 404 as "not present". A `.data.js` is the rare form, so the common case was a guaranteed miss — and because the probe re-runs on every auto-refresh tick, a 1s-refresh asset produced one 404 per second. The server already knew the answer: `@lerret/cli`'s plugin now runs core's `loadAssetData` (the same function `export` uses) and ships the resolved path per asset as `assetDataEntries` in the virtual module, refreshed on every `lerret:change`. The canvas fetches exactly that file — one request for an asset with data, **none** for an asset without. Creating or deleting a data file still reaches the canvas live: the reload subscription continues to watch both possible paths, and the fetch target is resolved at fetch time rather than memoized, so a watcher-driven update needs no remount. Where no map is registered — hosted mode, the standalone fixture harness, or a studio bundle served by an older CLI — the original probing path is kept, so the bundle stays compatible in both directions.

## @lerret/cli 0.1.13 — 2026-09-21

### Fixed
- **The studio rendered a blank page and `export` wrote 0 images.** Both surfaces were dead on a freshly scaffolded project: `dev` loaded the studio but painted nothing, and `export` failed every artboard with "studio did not render page … within 30s". The published CLI serves its pre-built `dist-studio/` from inside `node_modules/`, and Vite's resolver stamps `?v=<browserHash>` onto any import resolving to a file under `node_modules` — including the bundle's own chunk-to-chunk imports. The `<script>` tag in `index.html` loads the entry chunk *without* that query, so the browser held two urls for one module, evaluated `main.jsx` twice, and called `createRoot()` twice on `#root`; the downstream `removeChild` / `insertBefore` failures were two React roots fighting over one DOM subtree. A new `enforce: 'pre'` resolver (`studioChunkResolvePlugin`) now resolves the bundle's own chunk urls itself — both relative imports and the root-absolute urls the script tag and Rolldown's `__vite__mapDeps` preload helper use — so every chunk keeps a single identity. The bug was invisible in-repo, where `dist-studio/` is not under `node_modules/`; a new opt-in smoke (`dist-studio-node-modules.smoke.test.js`) stages the real bundle under a `node_modules/` path and drives a browser at it.

## @lerret/cli 0.1.11 — 2026-05-22

### Fixed
- `@lerret/cli export` now captures artboards across **every** project page on a project-scope run, not just the first one. The studio's `ProjectCanvas` (`packages/studio/src/components/canvas/project-canvas.jsx`) only mounts one page at a time, driven by a hash route. Previously the CLI navigated to the bare studio URL and waited for the first slot — non-first pages' slots never appeared in the DOM, so those captures failed with "slot not found" (or, on page-scope runs targeting a non-first page, timed out with "studio did not render any artboards within 30s"). The orchestrator now groups expanded artboards by `pagePath`, sets `window.location.hash = '#<pagePath>'` to drive the studio's `useHashRoute`, waits for that page's first slot to attach, then captures all of its artboards before moving on. A per-page render failure is isolated — other pages still write. No studio changes were needed; the hash-route primitive was already there for the dock's page picker.

## @lerret/cli 0.1.10 — 2026-05-22

### Fixed
- `@lerret/cli export` (structured / default layout) now includes the page name in each artboard's output path, matching the PRD shape `<out>/<page>[/<group>[/…]]/<asset.name>[-<variant>].<ext>`. Previously the page level was silently dropped, so a project with `landing/heroes/Card1.jsx` and `social/Banner.jsx` wrote both into a shared top level (`out/heroes/Card1.png`, `out/Banner.png`) — losing the page and risking same-named-folder collisions across pages. The fix is CLI-only: `buildOutputPath` derives the page name from `artboard.pagePath` and prepends it in structured mode. `--flat` is unaffected. The studio's in-browser ZIP exporter is unchanged (its ZIP is rooted at the export scope, so the omission is intentional there).

## @lerret/cli 0.1.9 — 2026-05-22

### Changed
- Canonical naming sweep: every user-visible reference to the bare `lerret dev` / `lerret export` invocation is now `@lerret/cli dev` / `@lerret/cli export` — including the CLI's own `printUsage()` banners, log-line prefixes (`@lerret/cli dev: project …`), error messages (`@lerret/cli: unknown command …`), all `apps/docs/content/*.mdx`, public READMEs, `CONTRIBUTING.md`, source/JSDoc comments, and BMad planning artifacts. The `bin` field still ships `lerret` on PATH after install, but `npx`-context invocations use the scoped form (the bare `lerret` package name on npm belongs to an unrelated deprecated project). Rationale recorded in `_bmad-output/planning-artifacts/adr-002-cli-package-naming.md`.

## @lerret/cli 0.1.8 — 2026-05-22

### Fixed
- `lerret export` against the bundled `dist-studio/` no longer fails on every artboard with `Failed to fetch dynamically imported module: /src/export/capture.js`. The page-side capture call now uses a `window.__lerret_capture` hook published by the studio's CLI-mode entry, which survives production bundling. The earlier `import('/src/export/capture.js')` only worked when Vite served the studio from source — against the production bundle (hashed chunks) the source path 404'd and the studio chrome cascaded into the downstream `useState` null error.
- `lerret export` now sets the same `react` / `react-dom` / `react/jsx-(dev-)runtime` resolve aliases `lerret dev` already had, so user `.jsx`/`.tsx` assets transform correctly when the CLI is serving the pre-built bundle.

## @lerret/cli 0.1.5 — 2026-05-22

### Changed
- Republished alongside the docs URL canonicalization. All README and badge references switched from `lerret-docs.web.app` to the branded `docs.lerret.io`. No code changes.

## @lerret/cli 0.1.4 — 2026-05-22

### Fixed
- Bundled studio UI no longer prompts users with the unusable `npx lerret …` form. The unsupported-browser screen now shows `npx @lerret/cli dev`; the "not a Lerret project" empty state now shows `npx create-lerret my-canvas` (the previous `npx lerret init` was broken on two counts — bare `lerret` is squatted on npm, and `init` is not a real subcommand).
- Sweep across docs, READMEs, source comments, and workflow files to scope every CLI reference to `@lerret/cli` in the contexts where the bare form would resolve to a different (unrelated, deprecated) npm package.

## @lerret/cli 0.1.3 — 2026-05-21

### Fixed
- `react/jsx-runtime` and `react/jsx-dev-runtime` now resolve from the CLI's bundled React when running outside a workspace install.
- Republished via `pnpm publish` to resolve the `workspace:^` specifier for `@lerret/core` (an earlier `npm publish` leaked the workspace protocol into the tarball).

## @lerret/cli 0.1.1 — 2026-05-21

### Added
- Per-package README shipped inside the npm tarball.

## @lerret/cli 0.1.0 — 2026-05-21

### Added
- First public release. Two subcommands: `lerret dev` (Vite dev server + bundled studio) and `lerret export` (headless Chromium via Playwright).
- Zero-install execution verified across npm, pnpm, yarn, and bun.

## @lerret/core 0.1.2 — 2026-05-22

### Changed
- Republished alongside the docs URL canonicalization. README points at `docs.lerret.io`. No code changes.

## @lerret/core 0.1.1 — 2026-05-21

### Added
- Per-package README.

## @lerret/core 0.1.0 — 2026-05-21

### Added
- First public release. Environment-agnostic engine: filesystem contract, project loader, watcher, config cascade with deep-merge semantics, four-tier prop resolution, variant resolution, props validation, export traversal helper.

## create-lerret 0.1.4 — 2026-08-18

### Added
- Default scaffold is now a five-page teaching kit instead of the three standalone social assets it shipped at 0.1.0. Each page teaches one Lerret idea and carries a Markdown card explaining it: `intro/` (welcome), `landing/` (config vars, `landing-hero.jsx` + `about-vars.md`), `social/` (`.data.json` sidecars, `tw-banner.jsx` + `og-card.jsx` with their data files), `brand/` (props validation, `business-card.jsx` + data), and `live/` (LiveRefresh, `clock.jsx` + `counter.jsx` with their `.config.json` files). A shared `vars` block in `.lerret/config.json` re-skins the kit.
- AI-tool integration files, rendered at scaffold time from `src/ai-content.js` rather than copied from the template: `.claude/` (an author skill and an edit command), `.cursor/rules/lerret.mdc`, `.github/copilot-instructions.md`, and `AGENTS.md`. Every file written is enumerated in the success message — no silent writes. They ship with minimal (`--no-samples`) scaffolds too, since an empty project is where authoring guidance helps most.
- `--no-ai-rules` skips all four AI-tool surfaces; `--ai-tools=<list>` scopes them to a comma-separated subset of `claude`, `cursor`, `copilot`, `agents`. Passing `--ai-tools` more than once is rejected rather than silently collapsed to the last value, which is what `node:util` `parseArgs` would otherwise do.
- `--preset <name>` scaffolds a named preset from `presets.json` in place of the teaching kit: `acme`, `appstore`, `producthunt`, `social-media`, `talks`, `personal`, `live`.
- `--demo` scaffolds the teaching kit, writes a `.lerret/.state/first-run.json` marker so the studio offers the walkthrough on first mount, and spawns `@lerret/cli dev --open`. Both the marker write and the spawn are best-effort — either failing leaves a working project rather than an error.
- Mutual exclusions, each rejected with an explanation rather than a silent precedence rule: `--no-ai-rules` with `--ai-tools`, `--preset` with `--no-samples`, `--demo` with `--preset`, and `--demo` with `--no-samples`.

### Changed
- `scripts/zero-install-smoke.sh` `verify_full_tree` now asserts the five-page teaching kit files (`intro/welcome.md`, `landing/landing-hero.jsx`, `social/tw-banner.jsx`, `brand/business-card.jsx`, `live/clock.jsx`) instead of the deleted `twitter-banner` / `instagram-square` / `youtube-thumbnail` paths, which made the smoke run fail against every scaffold since 0.1.4.
- `packages/create-lerret/README.md` "Options" and "What it produces" rewritten against the template and CLI source. The npm page was still advertising a `twitter-banner` / `instagram-square` / `youtube-thumbnail` kit the scaffolder no longer writes, and documented none of the flags above. The scaffold tree is now file-for-file what `fsp.cp` copies out of `template/.lerret/`.

## create-lerret 0.1.3 — 2026-05-22

### Changed
- Republished alongside the docs URL canonicalization. README points at `docs.lerret.io`. No code changes.

## create-lerret 0.1.2 — 2026-05-21

### Fixed
- Next-steps message now prints `npx @lerret/cli dev` (the bare `npx lerret dev` resolves to a different, unrelated npm package).

## create-lerret 0.1.1 — 2026-05-21

### Added
- Per-package README.

## create-lerret 0.1.0 — 2026-05-21

### Added
- First public release. Two scaffold modes: full template with sample assets (default) and minimal empty project (`--no-samples`).
- Zero runtime dependencies — the package is template files plus a single Node script.

[Unreleased]: https://github.com/belikely-united/lerret/compare/HEAD...HEAD
