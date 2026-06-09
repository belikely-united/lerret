# Provider capability matrix — update cadence

`capabilities.json` lists per-`(provider, model)` `{vision, contextWindow}`
flags. The matrix ships frozen with each `@lerret/ai` package release; the
runtime does NOT fetch the matrix from any external service.

## When to update

- New vision-capable model lands at a vendor we already track → add a row.
- Vendor deprecates a model → leave the row (downstream users may still
  reference it); flip `vision` to `false` if the deprecated endpoint stops
  honoring image content.
- New OpenRouter top-10 model → swap the existing row.

## How to update

1. Edit `capabilities.json` (add / modify the entry).
2. Add a test in `capabilities.test.js` asserting the new entry.
3. Bump the `@lerret/ai` patch version.
4. Publish.

## Fail-closed default

Unknown `(provider, model)` pairs return `{vision: false, contextWindow:
8192}`. This is intentional — the orchestrator must not attach screenshots
to a model it does not know supports them (image-block payloads against a
non-vision model are an obvious user-facing error). Add new rows to bring
known models into the matrix; do NOT relax the default.
