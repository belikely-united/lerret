---
name: dev
description: Start the Lerret studio dev server for live, hot-reloading editing of a project. Use when the user wants to open the studio, see a live canvas, or interactively edit a Lerret project.
allowed-tools: Bash(npx @lerret/cli@latest *)
---

# Run the Lerret studio (dev server)

Thin wrapper over `@lerret/cli dev`. Boots a Vite studio with HMR against the nearest `.lerret/` project.

```sh
npx @lerret/cli@latest dev --port 5173 --folder <path-to-project>
```

- `--port <n>` · `--folder <path>` (defaults to the nearest `.lerret/`) · `--open` / `--no-open`.

**This server is long-running** — it only stops on Ctrl-C. Start it as a background process, then surface the local URL to the user. In the Claude Code desktop app, the preview surface can display it live.
