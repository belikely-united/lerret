---
name: export
description: Render Lerret assets to image files (PNG/JPG). Use when the user wants to export, render, or save a Lerret design as an image, or to preview an asset after authoring it.
allowed-tools: Bash(npx @lerret/cli@latest *), Read
---

# Export Lerret assets

Thin wrapper over `@lerret/cli export` — the CLI does the headless render; nothing is reimplemented here.

```sh
npx @lerret/cli@latest export [path] --format png --out <dir>
```

- `[path]` — a **folder** scope: the project root, or a page/group folder inside `.lerret/` (e.g. `.lerret/social`). **Not** a single `.jsx` file or variant — scope to the folder that contains the asset. Omit to export the whole project. Run from the project root (it walks up to find `.lerret/`).
- `--format png|jpg` · `--out <dir>` · `--flat` (don't mirror the folder tree) · `--data <file>` / `--config <file>` (override the data/config tier for the run).

After exporting, `Read` the produced image to confirm the result, then report the output path to the user.
