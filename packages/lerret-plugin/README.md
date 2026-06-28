# @lerret/plugin — Lerret as a Claude Code plugin

Author and export [Lerret](https://lerret.belikely.com) design assets from inside Claude Code.
**Your own Claude is the design brain** — this plugin wraps the published `@lerret/cli`, so there is
**no duplicated logic and no AI keys/providers**.

## The agent — just say "lerret"

You don't have to remember any of the skills below. Say **`lerret`** (or `@agent-lerret`) and the
**Lerret agent** takes over: it sets the project up if needed, designs what you describe, shows it to
you, and exports it — routing to the right skill for you.

> "lerret, make me a launch banner" → it checks for a project (sets one up if missing), authors the
> asset, renders it, and offers to open the live studio.

## Skills

| Skill | What it does | Wraps |
|-------|--------------|-------|
| `/lerret:setup`   | First-run: scaffold a project or add Lerret to the current one | `create-lerret` |
| `/lerret:author`  | Claude designs/edits `.jsx` assets, then renders to verify | (Claude + CLI) |
| `/lerret:preview` | Run the studio and show it **live in the Claude preview** to see + edit | `@lerret/cli dev` |
| `/lerret:export`  | Render assets to PNG/JPG | `@lerret/cli export` |
| `/lerret:clear`   | Wipe sample assets / start fresh | `@lerret/cli clear` |

All are also model-invoked: in chat, "make me an OG image" triggers `author`; the first Lerret action
in a fresh project triggers `setup`.

## Install

```sh
/plugin marketplace add Belikely-United/marketplace
/plugin install lerret@belikely-united
```

Then just talk to it — no `.lerret/` folder needed first; it'll offer to set one up:

```sh
lerret make a 1200x630 og-image with the title "Ship faster"
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
