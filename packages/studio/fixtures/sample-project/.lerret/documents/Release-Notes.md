# Release Notes — v0.4

A rich-preview Markdown asset. This `.md` file is *user content* — exactly the
kind of notes or copy document a Lerret user keeps **alongside** their
component artboards on the canvas.

## What changed

- Added the **Markdown asset card** — `.md` files now render as document cards.
- Component artboards and document cards share the same canvas section.
- Auto-height: a document card grows with its content.

## Editing model

Markdown is edited [at the source](https://lerret.belikely.com) — your editor,
an AI loop, or the in-studio Markdown editor — and the canvas re-renders.

> A Lerret project is just a folder of files. The canvas is a *view*.

### Code blocks render too

Inline `code` is styled, and fenced blocks keep their formatting:

```jsx
export default function Badge() {
 return <span className="badge">New</span>;
}
```

#### Ordered lists

1. Drop a `.md` file into a page or group.
2. The runtime reads its raw text.
3. It renders as a document card.

---

That horizontal rule, this paragraph, the headings above, the links, the
emphasis, and the code block together exercise every element the card styles.
