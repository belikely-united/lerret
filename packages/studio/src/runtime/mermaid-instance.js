// mermaid-instance.js — the studio's bundled Mermaid, re-exported as a
// STABLE-named entry chunk (`assets/mermaid-instance.js`) so a user's JSX
// asset can write a plain `import mermaid from 'mermaid'` (spec-mermaid-
// diagrams.md, Phase 3 / D6) and have it resolve with nothing installed:
//   - hosted: the build-time import map points `mermaid` here;
//   - CLI (pre-built studio): the dev/export server aliases `mermaid` here.
// Same pattern as react-instance.js.
export * from 'mermaid';
export { default } from 'mermaid';
