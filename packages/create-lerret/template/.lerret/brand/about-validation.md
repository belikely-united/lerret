# The ⚠️ validation badge — what it means and how to clear it

When you opened this page, one of the two business-card artboards showed a
small **⚠️ badge** in its kebab area. The other did not. That's the
`propsSchema` validation surface (FR32) doing its job.

## What's happening

`business-card.jsx` declares a `propsSchema` with a `name` field marked
`required: true` and — crucially — **no `default:`**. The four-tier prop
chain (see `social/about-data-files.md`) can't back-fill it, so when the
data file omits `name`, the resolved props object has no `name` and the
validator records a "Required prop is absent" failure.

The default artboard's data slice (`business-card.data.json` → `"default"`)
deliberately omits the `name` field:

```json
{
  "default": { "title": "maker", "email": "hello@example.com" }
}
```

So the badge fires. The `"Complete"` variant in the same data file
**includes** every required prop:

```json
{
  "Complete": {
    "name": "Ada Lovelace",
    "title": "designer of designs",
    "email": "ada@example.com",
    "location": "London / 1843"
  }
}
```

So the badge stays silent.

## Try it

1. **Click the ⚠️** on the default artboard. The studio surfaces the
   failure list — you'll see `name — Required prop is absent.`
2. Edit `brand/business-card.data.json`. Inside the `"default": { ... }`
   block, add `"name": "your name here"`.
3. Save. The badge clears immediately, and the `[ no name yet ]` placeholder
   on the artboard fills in with what you typed.

## When you'd see other badges

- **Type mismatch** — schema says `type: 'number'`, data file has a string.
- **Select out-of-range** — schema lists `options: ['a','b','c']`, data
  file passes `'d'`.
- **Number out-of-bounds** — schema has `min: 0`, data file has `-5`.

Every failure shows up on the same badge with a one-line reason. The badge
is purely informational — Lerret still renders the artboard. Your job is
to fix the underlying data (or the schema) when you see one.
