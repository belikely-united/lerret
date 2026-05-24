# Auto-refresh — making artboards tick

By default, a Lerret artboard renders once and stays still. That's correct
for most assets — a banner, a poster, an OG card shouldn't be re-rendering
themselves on a timer.

But some assets *should* tick: a clock, a countdown, an animated demo, a
live preview that watches an external data source. Lerret turns that on
**asset-by-asset** via **auto-refresh** — an `autoRefresh` interval set in
the asset's own co-located `<Name>.config.json`.

## How this folder is wired

Each ticking asset has a config file beside it, sharing the asset's
basename. Open `clock.config.json`. You'll see:

```json
{ "autoRefresh": 1000 }
```

`counter.config.json` is the same. The value is the **interval in
milliseconds**, so `clock.jsx` re-renders every 1000 ms and `counter.jsx`
re-renders every 1000 ms.

The Lerret runtime drives the cadence. Each component just uses normal
React hooks (`useState`, `useEffect` + `setInterval`) to compute the
current value.

## Try it

1. Change `autoRefresh` from `1000` to `100` in `clock.config.json`.
2. Save the file.
3. Watch the clock — the seconds digit now updates ten times per second
   instead of once. (Looks like garbage, by design — you've found the
   point where the auto-refresh cadence becomes faster than the rendering
   pipeline can keep up cleanly.)
4. Change it back to `1000` and the clock smooths out again.

The minimum interval is bounded — values below the floor are ignored with
a console warning. If you want to know the exact floor, search the studio
source for `MIN_INTERVAL_MS`.

## Per-asset, not per-folder

Auto-refresh lives next to the **asset**, not in the folder `config.json`.
To make a new asset tick, drop a `<Name>.config.json` beside it (e.g.
`live/my-clock.jsx` → `live/my-clock.config.json` with
`{ "autoRefresh": 1000 }`). No file, or no `autoRefresh` key, means the
asset stays still — so ticking is always opt-in, with no accidental
performance tax on the rest of the canvas. The config file is a companion:
it travels with the asset on move / rename / duplicate / delete, just like
`<Name>.data.json`.

## Auto-refresh vs. live reload

Don't confuse the two. **Auto-refresh** is this timer re-render — the asset
repaints on its own with no file change. **Live reload** is the file-save
loop: when you edit and save an asset's source, the studio HMRs and the
artboard repaints. Different mechanisms, different triggers.
