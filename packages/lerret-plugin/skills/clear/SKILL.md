---
name: clear
description: Remove sample assets or specific paths from a Lerret project. Use when the user wants to wipe the scaffolded samples, start fresh, or delete a specific page/asset. config.json and _fonts/ are always preserved.
allowed-tools: Bash(npx @lerret/cli@latest *)
---

# Clear Lerret samples / paths

Thin wrapper over `@lerret/cli clear`. Always preserves `.lerret/config.json` and `.lerret/_fonts/` — those are project state, not samples.

```sh
npx @lerret/cli@latest clear [path...] --all --yes --dry-run
```

- `[path...]` — targets; a bare name (e.g. `social`) resolves under `.lerret/`.
- `--all` — wipe every page except the protected ones (mutually exclusive with positional paths).
- `--yes` — skip the y/N confirmation (required for non-interactive runs).
- `--dry-run` — print the plan, change nothing. Suggest this first when the user is unsure.
