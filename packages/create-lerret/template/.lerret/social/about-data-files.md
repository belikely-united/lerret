# Variants, data files, and the four-tier prop chain

This page has two components on it. Each demonstrates a different piece of
the props-and-data system Lerret uses.

## `tw-banner.jsx` — named-export variants

One file, three artboards. The component exports `default`, `Maker`, and
`Talk`. Each is a thin wrapper around the shared `TwBanner` implementation
and the studio renders them as **three separate artboards**.

Per-variant props come from `tw-banner.data.json`, which is **keyed by the
export name**:

```json
{
  "default": { "title": "..." },
  "Maker":   { "title": "..." },
  "Talk":    { "title": "..." }
}
```

Add a fourth named export (say `Hunter`) to the JSX and a fourth `"Hunter"`
slice to the data file — the canvas immediately shows a fourth artboard.

## `og-card.jsx` — `propsSchema` + co-located data

The second component exports `meta.propsSchema` — a declarative description
of every prop the component accepts. Lerret reads it for two things:

1. **The Data editor** (kebab → "Edit data") renders the right control per
   prop: a text input for `headline`, a select for `tone`, etc.
2. **Validation** — required props with no value, or values that don't match
   the schema (e.g. a `tone` not in `['dark','light','brand']`), trigger
   the ⚠️ badge on the artboard. (See `brand/` for that flow in action.)

Real props are pulled from `og-card.data.json`, sitting next to the asset.

## The four-tier prop-resolution chain (FR24)

When the runtime renders `og-card.jsx`, it resolves each prop by walking
**four tiers** in order. The first hit wins:

1. **Data file (`og-card.data.json`)** — explicit value for this asset.
   This is the highest-precedence and easiest-to-edit knob.
2. **Cascaded config `vars`** — values from `.lerret/config.json` (or any
   `social/config.json`, etc.) that share a name with a prop. Useful for
   theme tokens like `brandColor` that the same component re-uses
   automatically across pages.
3. **`propsSchema` defaults** — the `default:` field inside each prop's
   schema entry. The "true" default, declared near the prop description.
4. **Component function defaults** — the `= '...'` defaults in the function
   signature. Last-resort fallback if the schema didn't declare a default.

That's the whole order. Want to change one card? Edit the data file. Want
to change every card? Edit the config `vars`. Want to change the universal
fallback? Edit the schema default.
