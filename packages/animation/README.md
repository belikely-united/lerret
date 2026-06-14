# @lerret/animation

Animated-export engine for [Lerret](https://lerret.belikely.com) — frame capture plus WebP / GIF / APNG / MP4 encoders behind a single `AnimationEncoder` interface.

This package is the home for every byte of Lerret's animation code. The other Lerret packages (`@lerret/studio`, `@lerret/cli`) reach this code **only** via dynamic import (`await import('@lerret/animation')`) — never statically. That boundary keeps the studio's main chunk free of encoder code, lets you remove the dependency cleanly in one PR if you ever need to slim down the install, and gives animation its own test/version/release lane.

## What's inside

- `AnimationEncoder` interface — one shape every encoder implements
- `captureFrames(element, options)` — frame-capture loop reusing the v1 `html-to-image` path
- `encoders/webp.js`, `gif.js`, `apng.js` — pure-JS encoders
- `encoders/mp4.js` — browser-native WebCodecs `VideoEncoder` + [`mp4-muxer`](https://www.npmjs.com/package/mp4-muxer)

## Why a separate package

- **Easy to debug.** Animation code can be exercised, tested, and versioned independently of the studio.
- **Easy to remove.** Drop the `optionalDependency` from `@lerret/cli`, delete two `await import` call-sites, delete `packages/animation/`. One PR.
- **Stays free.** Per Lerret's positioning, animation is a core OSS feature and will never move behind a paid tier.

## Browser support

MP4 uses the native WebCodecs `VideoEncoder` API: Chromium 94+, Safari 16.4+, Firefox 130+. Lerret's hosted-mode floor is already Chromium (File System Access API), so MP4 works on every browser Lerret already supports. WebP / GIF / APNG use pure-JS encoders and work universally.

## License

AGPL-3.0 © Belikely United LLP. Commercial license available — see LICENSING.md.
