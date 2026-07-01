# @lerret/plugin — Lerret as a Claude Code plugin

One command — **`/lerret`** — turns a plain request into a polished [Lerret](https://lerret.belikely.com)
design asset, from inside Claude Code. **Your own Claude is the design brain**: the plugin wraps the
published `@lerret/cli`, so there's **no duplicated logic and no AI keys/providers**.

## Install

```sh
/plugin marketplace add Belikely-United/marketplace
/plugin install lerret@belikely-united
```

## Use it — just `/lerret`

```sh
/lerret make a 1200x630 og-image titled "Ship faster"
```

`/lerret` is a single, do-anything entry. Describe what you want and it figures out the rest — you never
have to remember sub-commands or flags. It handles, by intent:

| You say… | It does |
|----------|---------|
| (first time, no `.lerret/`) | **Sets the project up** — asks, then scaffolds (`create-lerret`) or adds `.lerret/` in place |
| "make / design / edit …" | **Authors** the `.jsx` asset, then renders it to verify |
| "show / preview / open the studio" | **Previews** — boots the studio and surfaces the URL (live, interactive) |
| "export / render to files" | **Exports** to PNG/JPG |
| "clear / wipe samples" | **Clears** samples (keeps `config.json` + `_fonts/`) |

It's also model-invoked: saying "make me an OG image" triggers it without typing the command.

## Design + preview surface
- Runs wherever Claude Code runs: the CLI, the **desktop app** (with the in-app preview), VS Code, `claude.ai/code`. **Not** the plain `claude.ai` chat.
- **Live preview:** on clients with a preview feature (the **desktop app**), `/lerret` renders the studio **inside the Claude Code preview pane** — it writes a `.claude/launch.json` `lerret-studio` config and launches it through the preview tool, so it appears in-pane (not a browser). On clients without a preview feature, it backgrounds the dev server and hands you the `localhost` URL. Either way the studio is fully interactive.
- Requires Claude Code **v2.1.142+** for the bare `/lerret` command (single-skill plugin).

## Single source of truth (no duplication)
- **Engine** — every action shells to the published `@lerret/cli`. Nothing re-implemented.
- **The skill itself** — the root `SKILL.md` is **generated** from `@lerret/create-lerret`'s `ai-content.js`
  (`renderPluginSkill()`), the same source that emits the scaffolded `lerret-author` skill, `AGENTS.md`,
  Cursor, and Copilot files. **Never hand-edit `SKILL.md`** — regenerate:

  ```sh
  pnpm --filter @lerret/plugin build
  ```

  A drift test (`create-lerret/src/plugin-skill.test.js`) fails CI if the committed skill diverges.

MIT © Be Likely United.
