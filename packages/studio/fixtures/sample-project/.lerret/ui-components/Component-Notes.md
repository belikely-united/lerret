# UI Components — Notes

A Markdown document card sitting **in the same section** as the component
artboards (`StatCard`, `Toast`, `HeroBanner`, ...). This proves the canvas lays
an auto-height document card next to fixed-dimension artboards without
disturbing their layout.

## Conventions

- Each component file `export default`s its primary artboard.
- A `meta` export declares `dimensions`, `label`, and `tags`.
- Named exports become *variants* — see `BadgeVariants.jsx`.

Keep copy notes like this one **with** the components they describe.
