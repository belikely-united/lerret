# Lerret demo project

A sample Lerret project. Point `@lerret/cli dev` at this folder — or click
**Try a demo** in the hosted studio — and the whole folder renders as a canvas.

## How it's organized

Everything lives on one page, `showcase/`, split into **groups** (sub-folders),
each shown as its own framed, tinted section on the canvas:

| Folder             | What's inside                                        |
| ------------------ | ---------------------------------------------------- |
| `showcase/brand/`  | brand tokens + a data-driven business card           |
| `showcase/social/` | social formats — Instagram, Open Graph, a quote card |
| `showcase/live/`   | auto-refreshing designs — a clock and a counter      |
| `showcase/launch/` | launch assets — a Product Hunt slide and a thumbnail |
| `showcase/slides/` | a talk deck — title, section dividers, closing slide |
| `showcase/site/`   | web assets — OG image, /now hero, favicon            |

Each group folder has a `config.json` (its section tint) and an `about.md`
explaining it. The shared brand tokens (colors, names) live in the root
`config.json` → `vars`, read by every design.

Edit any `.jsx` or `.md` file and the canvas re-renders instantly.
