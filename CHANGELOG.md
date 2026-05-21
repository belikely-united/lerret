# Changelog

All notable changes to Lerret are documented here. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

> Pre-1.0 versions (`0.x.y`) may include breaking changes between minor releases.

The published packages are [`@lerret/cli`](https://www.npmjs.com/package/@lerret/cli), [`@lerret/core`](https://www.npmjs.com/package/@lerret/core), and [`create-lerret`](https://www.npmjs.com/package/create-lerret). Each tracks its own SemVer; this file is the consolidated project changelog.

## [Unreleased]

### Added
- Marketing landing site scaffold (Astro 5) for `lerret.belikely.com`, hosted on Firebase. Private — lives in the maintainer workspace.
- `app/sitemap.js` and `app/robots.js` for the docs site so search crawlers (Algolia DocSearch first) can discover all pages.
- A "Community & support" channels table on the docs root.

### Changed
- Docs content expanded from 221 → 1,556 lines across 8 pages. Every CLI flag, prop tier, config rule, and asset behavior verified against the actual source in `packages/cli` and `packages/core`.
- Nextra global footer now surfaces GitHub, Discussions, Issues, npm, X, and `lerret.belikely.com` on every page; navbar gains a Discussions link.

### Fixed
- `docsRepositoryBase` in the Nextra layout pointed at the wrong path (missing the `public/` workspace prefix), which 404'd every "Edit this page on GitHub" link.

## @lerret/cli 0.1.8 — 2026-05-22

### Fixed
- `lerret export` against the bundled `dist-studio/` no longer fails on every artboard with `Failed to fetch dynamically imported module: /src/export/capture.js`. The page-side capture call now uses a `window.__lerret_capture` hook published by the studio's CLI-mode entry, which survives production bundling. The earlier `import('/src/export/capture.js')` only worked when Vite served the studio from source — against the production bundle (hashed chunks) the source path 404'd and the studio chrome cascaded into the downstream `useState` null error.
- `lerret export` now sets the same `react` / `react-dom` / `react/jsx-(dev-)runtime` resolve aliases `lerret dev` already had, so user `.jsx`/`.tsx` assets transform correctly when the CLI is serving the pre-built bundle.

## @lerret/cli 0.1.5 — 2026-05-22

### Changed
- Republished alongside the docs URL canonicalization. All README and badge references switched from `lerret-docs.web.app` to the branded `docs.lerret.belikely.com`. No code changes.

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
- Republished alongside the docs URL canonicalization. README points at `docs.lerret.belikely.com`. No code changes.

## @lerret/core 0.1.1 — 2026-05-21

### Added
- Per-package README.

## @lerret/core 0.1.0 — 2026-05-21

### Added
- First public release. Environment-agnostic engine: filesystem contract, project loader, watcher, config cascade with deep-merge semantics, four-tier prop resolution, variant resolution, props validation, export traversal helper.

## create-lerret 0.1.3 — 2026-05-22

### Changed
- Republished alongside the docs URL canonicalization. README points at `docs.lerret.belikely.com`. No code changes.

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
