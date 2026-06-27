# @lerret/core

> Environment-agnostic core for [Lerret](https://github.com/belikely-united/lerret) — shared loader, watcher, config cascade, and filesystem contract.

[![npm](https://img.shields.io/npm/v/%40lerret%2Fcore.svg)](https://www.npmjs.com/package/@lerret/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/belikely-united/lerret/blob/main/LICENSE)

This package contains the engine that powers the Lerret design canvas. **Most users don't install this directly** — they use [`@lerret/cli`](https://www.npmjs.com/package/@lerret/cli) (the CLI binary) or [`create-lerret`](https://www.npmjs.com/package/create-lerret) (the scaffolder).

`@lerret/core` exists as its own package so the engine can be reused by both backends — the Node `fs` adapter (CLI) and the browser File System Access API adapter (hosted studio) — and so advanced users can build their own integrations.

## What's inside

- Project loader — scans `.lerret/`, builds the model of pages, groups, and assets.
- File watcher — emits normalized change events; powers the sub-second live-edit loop.
- Config cascade — per-folder `config.json` merge semantics, including CSS-variable derivation.
- Data resolution — the four-tier prop precedence (data → config → schema default → function default).
- Filesystem contract — the `FilesystemAccess` interface; one boundary for every backend.

## Source & docs

- Source: [github.com/belikely-united/lerret](https://github.com/belikely-united/lerret) (`packages/core/`)
- Documentation: [docs.lerret.belikely.com](https://docs.lerret.belikely.com)

## License

[MIT](https://github.com/belikely-united/lerret/blob/main/LICENSE) — free to use, self-host, modify, and share.
