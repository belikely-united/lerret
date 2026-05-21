Reserved folder (underscore-prefixed) — NOT a page.

The project loader (packages/core/src/loader/scan.js) skips underscore-prefixed
folders directly under .lerret/ (FR5). This folder is here so the sample
project exercises that rule: it must not appear as a page on the canvas, but
its contents stay on disk so assets could import from it.

This .txt file is also a non-asset, non-config, non-data, non-resource file —
the loader excludes it from the model (FR6).
