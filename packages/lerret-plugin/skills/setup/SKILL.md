---
name: setup
description: Set up Lerret in a project for the first time. Use when the user wants to start using Lerret here, or when any Lerret action is requested but there is no `.lerret/` directory yet (first run). Scaffolds a new project or adds Lerret to the current one.
allowed-tools: Glob, Read, Write, Bash(npx create-lerret@latest *), Bash(ls *)
---

# Set up Lerret in this project

Run this the first time Lerret is used in a workspace. It is the gate before authoring: no `.lerret/`, no assets.

## 1. Is it already set up?
`Glob` for `**/.lerret/config.json`. If one exists, Lerret is already set up — tell the user where it is and stop (don't re-scaffold).

## 2. Ask the user how to set up
If there is no `.lerret/`, **ask which they want** (don't assume):

**(a) New project in a subfolder** — recommended for a fresh start. Creates a full project with the five-page teaching preset:
```sh
npx create-lerret@latest <name>
```
- `<name>` is a new (or empty) directory — `create-lerret` **refuses a non-empty directory**, so this can't target an existing project root.
- Add `--no-samples` for an empty project (just `.lerret/config.json`), or `--no-ai-rules` to skip the AI-tool files.

**(b) Add Lerret to the current directory, in place** — for an existing repo. Since `create-lerret` won't write into a non-empty dir, create the marker directly:
```
.lerret/config.json   →   { "vars": {} }
```
Write that one file (use `Write`). That's a valid empty Lerret project; the user then authors assets with the `author` skill. Offer to drop a starter asset (a `social/og-card.jsx`) if they want something on the canvas immediately.

## 3. Confirm, then act
State exactly what you'll create and where, get a yes, then run it. Never scaffold into a directory without confirming.

## 4. Next step
Once `.lerret/` exists, point the user at:
- `/lerret:author` (or just describe what you want) to create assets,
- `/lerret:preview` to see the studio live.
