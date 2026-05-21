<p align="center">
  <img src=".github/assets/lerret-logo.png" alt="Lerret" width="160" />
</p>

<h1 align="center">Lerret</h1>

<p align="center">
  <em>A design canvas where a folder of plain React component files renders as a visual canvas.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lerret/cli"><img src="https://img.shields.io/npm/v/%40lerret%2Fcli?label=lerret&color=B85B33" alt="npm version" /></a>
  <a href="https://github.com/belikely-united/lerret/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-B85B33" alt="MIT license" /></a>
  <a href="https://docs.lerret.belikely.com"><img src="https://img.shields.io/badge/docs-lerret.belikely.com-B85B33" alt="Documentation" /></a>
  <a href="https://github.com/belikely-united/lerret/discussions"><img src="https://img.shields.io/github/discussions/belikely-united/lerret?color=B85B33" alt="GitHub Discussions" /></a>
</p>

<!--
  TODO(visuals): drop a 10–15 s animated demo here showing
  (1) running `npx @lerret/cli dev` against a folder,
  (2) saving a .jsx file,
  (3) the canvas re-rendering with the live cue.

  Add the asset to .github/assets/ and re-add the <img> tag above
  this comment, e.g.:

  <p align="center">
    <img src=".github/assets/demo.gif" alt="Lerret canvas re-rendering on save" width="820" />
  </p>
-->

---

```bash
npx create-lerret my-canvas
cd my-canvas
npx @lerret/cli dev
```

That's it. The studio opens. Save any `.jsx` under `.lerret/`. The canvas re-renders in under a second.

---

## What it is

**Lerret turns a folder of React components into a visual canvas.** Each `.jsx`/`.tsx` file under `.lerret/` becomes a pan-and-zoom artboard. Save the file → the canvas updates. Export to PNG/JPG when you're done — single artboard, a whole page group, or the entire project as a structured ZIP.

There's no proprietary file format. There's no backend. There's no account. **Your components are the source of truth** — Lerret only renders them, and you can `git rm -rf .lerret/` tomorrow and still have a fully working set of React components.

## Why it exists

You're a developer. You need a social-share banner, a thumbnail, a release graphic, a component-library showcase. Today you have two choices:

1. **Open Figma**, redesign the thing pixel-by-pixel, export, and watch it drift from the components your app actually ships.
2. **Open a CSS file**, write `<div style={...}>`, hit refresh, twist the dev tools to crop it, screenshot, hope it looks OK.

Both lose. Lerret says: write the React component, save the file, see the canvas, export the image. The component you draft for the banner is the same kind of component that ships in your app. No vendor file. No round-trip.

## A complete asset, in one file

```jsx
// .lerret/social/twitter-banner.jsx
export default function TwitterBanner() {
  return (
    <div style={{
      width: 1500,
      height: 500,
      padding: '4rem',
      background: 'linear-gradient(135deg, #B85B33, #E0833F)',
      color: 'white',
      fontFamily: 'var(--lm-font-display, system-ui)',
    }}>
      <h1 style={{ fontSize: 72, fontWeight: 800, margin: 0 }}>
        Hello from Lerret
      </h1>
      <p style={{ fontSize: 24, opacity: 0.85, marginTop: '1rem' }}>
        It's just a React component.
      </p>
    </div>
  );
}

export const meta = {
  width: 1500,
  height: 500,
  tags: ['twitter', 'banner'],
};
```

Drop that file into `.lerret/social/`. It appears on the canvas as an artboard sized exactly 1500×500. Edit any number, save, watch it update.

## What's in the box

- **Studio** — pan-and-zoom canvas, per-artboard error boundaries, in-place editors for component props, data, and config.
- **CLI** — `npx @lerret/cli dev` opens a folder as a live canvas; `npx @lerret/cli export` headlessly renders to PNG/JPG (single asset, page group, or whole project as structured ZIP).
- **Live edit loop** — Vite's React Fast Refresh under the hood; saves land on the canvas in under a second.
- **Variants via named exports** — `export const Dark = ...` gives the same asset a second variant on the same canvas.
- **Per-folder config cascade** — a small `config.json` per folder propagates background colors, CSS variables, shared data down the tree.
- **Markdown assets too** — `.md` files render as document cards alongside your JSX.
- **Auto-registered fonts** — drop `.woff2` into `_fonts/` and it's available to every component.
- **`propsSchema` editors** — declare a JSON Schema in your `meta` and Lerret generates a typed form for editing the component's data without touching code.

## Three ways to run it

| Mode | What it is | When to use |
|---|---|---|
| **CLI** | `npx @lerret/cli dev` against a local folder. Native Vite HMR. | Your daily dev loop. |
| **Hosted** | The studio as a static site; open any local folder via the browser's File System Access API. Chromium-only. | One-tap "try it" link. No install. |
| **Self-host** | The same static studio, packaged for self-deployment. | Your own infra; private/team contexts. |

All three modes render the *same* folder. Switch freely. The `.lerret/` directory has zero Lerret code in it — your components stay portable.

## What it isn't

Lerret is honest about its scope so you can decide quickly:

- **Not a Figma replacement.** Figma is a vector design tool with a proprietary file format and a collaborative cursor culture. Lerret is a *rendering canvas for code*. Different category.
- **Not a "no-code" tool.** Every asset is a React component. If you don't write React, Lerret won't be your day-one tool.
- **Not a hosted SaaS.** There's no backend. Hosted mode is just a static site that talks to your local filesystem via the browser.

## Documentation

**[docs.lerret.belikely.com](https://docs.lerret.belikely.com)** — full docs site.

- [Getting Started](https://docs.lerret.belikely.com/getting-started/)
- [Concepts — the folder-canvas model](https://docs.lerret.belikely.com/concepts/)
- [Authoring Assets](https://docs.lerret.belikely.com/authoring/)
- [The Studio](https://docs.lerret.belikely.com/studio/)
- [CLI Reference](https://docs.lerret.belikely.com/cli/)
- [Deployment](https://docs.lerret.belikely.com/deploy/)

## Architecture at a glance

A small workspace of focused packages:

| Package | Role |
|---|---|
| [`@lerret/cli`](https://www.npmjs.com/package/@lerret/cli) | The user-facing CLI (`@lerret/cli dev`, `@lerret/cli export`). Bundles the studio. |
| [`@lerret/core`](https://www.npmjs.com/package/@lerret/core) | Environment-agnostic engine — loader, watcher, config cascade, filesystem contract. |
| [`create-lerret`](https://www.npmjs.com/package/create-lerret) | The project scaffolder. `npx create-lerret my-canvas`. |
| `@lerret/studio` *(workspace-only)* | The React studio app. Built and bundled into the CLI tarball. |

The studio talks to your filesystem through a single `FilesystemAccess` contract; the CLI provides the Node `fs` backend, the hosted mode provides the File System Access API backend. Same studio, same canvas, same renderer.

## Requirements

- **Node.js ≥ 20.19**
- For the hosted studio: a Chromium-based browser (Chrome, Edge, Brave, Arc — the File System Access API gates this).
- The CLI works anywhere Node runs.

## Status

Lerret is **0.1.x** — the first public release. The folder-canvas model, the live-edit loop, in-studio editing, the export pipeline, and zero-install across npm/pnpm/yarn/bun are all working today. Expect some sharp edges in the 0.1 series; the public API stabilizes for 1.0.

Open issues, bug reports, and ideas are very welcome.

## Community

- **[GitHub Discussions](https://github.com/belikely-united/lerret/discussions)** — questions, ideas, show-and-tell.
- **[Issues](https://github.com/belikely-united/lerret/issues)** — bugs and feature requests.
- Security disclosures: [SECURITY.md](SECURITY.md).

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, code style, and where to start. The [issue tracker](https://github.com/belikely-united/lerret/issues) is the best place for "where can I help?" — anything labelled `good first issue` is a soft landing.

By contributing you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) — use it, fork it, build on it.

---

<p align="center">
  Built openly by <a href="https://github.com/belikely-united">Belikely United</a>.
  <br />
  <em>If a folder can be a canvas, what else can be?</em>
</p>
