---
name: preview
description: Run the Lerret studio and show it live so the user can see and interact with their project. Use when the user wants to preview, see, open, run, or edit their Lerret project visually ("show me", "preview it", "open the studio", "let me edit it").
allowed-tools: Bash(npx @lerret/cli@latest *)
---

# Preview the Lerret studio

Boots the interactive studio (Vite + HMR) so the user can **see and manipulate** their project live. Thin wrapper over `@lerret/cli dev` — the studio itself is the editor.

## Steps
1. **First run?** If there's no `.lerret/`, run the `setup` skill first — there's nothing to preview yet.
2. **Start the studio in the background** (it's long-running — only stops on Ctrl-C, so never run it in the foreground):
   ```sh
   npx @lerret/cli@latest dev --port 5173 --folder <path-to-project>
   ```
   (`--folder` defaults to the nearest `.lerret/`; omit `--port` to let Vite pick one.)
3. **Capture the local URL** it prints (e.g. `http://localhost:5173`).
4. **Show it in the Claude Code preview.** Open that URL in the preview pane so the studio renders inline and the user can click, edit, and rearrange — the studio is fully interactive. In the desktop app this lands in the preview surface; in other clients, give the user the URL to open.

## Notes
- HMR is live: any asset/data/config edit you make (or the user makes) re-renders instantly in the preview.
- Keep the dev server running while the user works; stop it when they're done.
- To render final image files instead of a live view, use the `export` skill.
