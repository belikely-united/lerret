# Pricing tiers as variants

One file, three artboards. `tiers/pricing-tier.jsx` exports a **default** plus
two **named components** — Lerret renders each named export as its own
artboard, so a single file becomes a full set.

This is the same mechanism the business card uses, but driven by code rather
than a data file: reach for **named-export variants** when the variants differ
in *structure*, and **data-file variants** when they differ only in *content*.
