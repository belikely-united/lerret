# @lerret/plugin — Lerret as a Claude Code plugin

Author and export [Lerret](https://lerret.belikely.com) design assets from inside Claude Code.
**Your own Claude is the design brain** — this plugin wraps the published `@lerret/cli`, so there is
**no duplicated logic and no AI keys/providers**.

## Skills

| Skill | What it does | Wraps |
|-------|--------------|-------|
| `/lerret:author` | Claude designs/edits `.jsx` assets, then renders to verify | (Claude + CLI) |
| `/lerret:export` | Render assets to PNG/JPG | `@lerret/cli export` |
| `/lerret:dev`    | Live hot-reloading studio canvas | `@lerret/cli dev` |
| `/lerret:clear`  | Wipe sample assets / start fresh | `@lerret/cli clear` |

All are also model-invoked: in chat, "make me an OG image" triggers `author`.

## Install

```sh
/plugin marketplace add Belikely-United/marketplace
/plugin install lerret@belikely-united
```

Then, in a project with a `.lerret/` folder:

```sh
/lerret:author make a 1200x630 og-image with the title "Ship faster"
```

## Single source of truth (no duplication)

- **Engine** — every command shells to the published `@lerret/cli`. Nothing re-implemented.
- **Authoring knowledge** — `skills/author/SKILL.md` is **generated** from `@lerret/create-lerret`'s
  `ai-content.js` (`renderPluginSkill()`), the same source that emits the scaffolded `lerret-author`
  skill, `AGENTS.md`, Cursor, and Copilot files. **Never hand-edit it** — regenerate:

  ```sh
  pnpm --filter @lerret/plugin build
  ```

  A drift test (`create-lerret/src/plugin-skill.test.js`) fails CI if the committed skill diverges.

## Runs where Claude Code runs
CLI, the desktop app (with live preview), VS Code, and `claude.ai/code`. **Not** the plain `claude.ai` chat.

## What it is / isn't
- **Is**: a thin orchestration layer over `@lerret/cli`; the user's Claude is the AI.
- **Isn't**: a port of `@lerret/ai` (the in-studio LangGraph stack) — on this path it's intentionally unused, not duplicated.

MIT © Be Likely United.
