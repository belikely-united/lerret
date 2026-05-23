# `liveRefresh` — making artboards tick

By default, a Lerret artboard renders once and stays still. That's correct
for most assets — a banner, a poster, an OG card shouldn't be re-rendering
themselves on a timer.

But some assets *should* tick: a clock, a countdown, an animated demo, a
live preview that watches an external data source. Lerret turns that on
asset-by-asset via the **`liveRefresh`** field in a folder's `config.json`.

## How this folder is wired

Open `live/config.json`. You'll see:

```json
{
  "liveRefresh": {
    "clock":   1000,
    "counter": 1000
  }
}
```

The keys are **asset names** (the filename without `.jsx`). The values are
**intervals in milliseconds**. So `clock.jsx` re-renders every 1000 ms and
`counter.jsx` re-renders every 1000 ms.

The Lerret runtime drives the cadence. Each component just uses normal
React hooks (`useState`, `useEffect` + `setInterval`) to compute the
current value.

## Try it

1. Change `clock` from `1000` to `100` in `live/config.json`.
2. Save the file.
3. Watch the clock — the seconds digit now updates ten times per second
   instead of once. (Looks like garbage, by design — you've found the
   point where the LiveRefresh cadence becomes faster than the rendering
   pipeline can keep up cleanly.)
4. Change it back to `1000` and the clock smooths out again.

The minimum interval is bounded — values below the floor are ignored with
a console warning. If you want to know the exact floor, search the studio
source for `MIN_INTERVAL_MS`.

## Per-page, not per-project

`liveRefresh` lives at the page (or group) level — drop a `live/config.json`,
a `live/clock/config.json`, etc. — never in the project root. That keeps
ticking opt-in and prevents accidental performance taxes on the rest of
the canvas.
