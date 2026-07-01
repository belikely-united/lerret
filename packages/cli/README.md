# lerret

> An open-source design canvas where a folder of plain React component files renders as a visual canvas.

[![npm](https://img.shields.io/npm/v/%40lerret%2Fcli.svg)](https://www.npmjs.com/package/@lerret/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/belikely-united/lerret/blob/main/LICENSE)

Lerret turns a folder of `.jsx`/`.tsx` components into a live, navigable canvas — pan-and-zoom artboards, sub-second hot reload on save, and headless export to image files. No proprietary format, no backend, no account required.

## Quick start

```sh
npx create-lerret@latest my-canvas
cd my-canvas
npx @lerret/cli@latest dev
```

The studio opens in your browser. Save any `.jsx` file under `.lerret/` and the canvas re-renders.

## What's in the package

This package ships the `lerret` binary:

- `@lerret/cli dev` — run the studio against a `.lerret/` folder (Vite dev server + bundled studio).
- `@lerret/cli export` — headlessly render a project (or page/group) to image files.

After installing globally (`npm install -g @lerret/cli`), the command is just `lerret`.

## Author with AI (Claude Code plugin)

If you use [Claude Code](https://claude.com/claude-code), Lerret ships as a plugin that wraps this CLI — no API keys, your own Claude designs the assets:

```text
/plugin marketplace add Belikely-United/marketplace
/plugin install lerret@belikely-united
/lerret make a 1200x630 og-image titled "Ship faster"
```

One do-anything `/lerret` command: it authors the `.jsx`, renders to verify, previews, or exports — all by describing what you want. Runs in Claude Code only (CLI, desktop app, VS Code, `claude.ai/code`).

## Requirements

- Node.js ≥ 20.19
- A Chromium-based browser (Chrome, Edge, Brave, Arc) for the studio. The CLI itself works anywhere Node runs.

## Documentation

Full docs: **https://docs.lerret.belikely.com**

- [Getting Started](https://docs.lerret.belikely.com/getting-started/)
- [Concepts — the folder-canvas model](https://docs.lerret.belikely.com/concepts/)
- [Authoring Assets](https://docs.lerret.belikely.com/authoring/)
- [CLI Reference](https://docs.lerret.belikely.com/cli/)

## Source & community

- Source: [github.com/belikely-united/lerret](https://github.com/belikely-united/lerret)
- Discussions: [github.com/belikely-united/lerret/discussions](https://github.com/belikely-united/lerret/discussions)
- Issues: [github.com/belikely-united/lerret/issues](https://github.com/belikely-united/lerret/issues)
- Maintainer: [@sooryagangaraj on X](https://x.com/sooryagangaraj)

## License

[MIT](https://github.com/belikely-united/lerret/blob/main/LICENSE) — free to use, self-host, modify, and share.
