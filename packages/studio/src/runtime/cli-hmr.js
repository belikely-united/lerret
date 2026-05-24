// cli-hmr.js — a build-safe bridge to the CLI's `lerret:change` custom HMR event.
//
// ── The problem this exists to solve ───────────────────────────────────────
// `@lerret/cli dev` pushes live-edit updates to the studio over Vite's HMR
// custom-events channel (`server.hot.send('lerret:change', …)`). The natural
// way to receive that is `import.meta.hot.on('lerret:change', …)`. But
// `import.meta.hot` is a DEV-ONLY construct: `vite build` replaces it with
// `undefined` and tree-shakes away any block guarded by it. The published CLI
// serves the **pre-built** `dist-studio` bundle, so every `import.meta.hot`
// listener silently vanishes there — and live edit (save re-render, rename,
// move, create, data edits) stops reaching the canvas.
//
// ── How this bridges it ────────────────────────────────────────────────────
// The CLI serves the studio through a real Vite DEV server in BOTH source and
// pre-built modes, and that server always injects `/@vite/client` into the
// served HTML. `/@vite/client` exposes `createHotContext`, the same primitive
// Vite uses to build every module's `import.meta.hot`. We reach it directly via
// a runtime `import('/@vite/client')` — a dev-server URL the bundler must NOT
// try to resolve at build time, hence `/* @vite-ignore */`. The resulting hot
// context registers a listener on the already-connected HMR WebSocket, so the
// `lerret:change` event is received even from a production bundle.
//
// One shared hot context fans every event out to a set of subscribers, so any
// number of components can listen without each creating its own context (which
// would leak, and — because re-creating a context for the same owner id purges
// the previous one's listeners — would clobber each other).
//
// On a host with no Vite dev server (e.g. a static export preview) the
// `/@vite/client` import simply rejects; live edit is unavailable there, which
// is correct, and nothing throws.

/** The custom HMR event the CLI plugin sends. Must match `HMR_CHANGE_EVENT` in
 * `packages/cli/src/vite-plugin-lerret-project.js`. */
const LERRET_CHANGE_EVENT = 'lerret:change';

/** Subscribers to fan each `lerret:change` payload out to. */
const handlers = new Set();

/** Guards against installing the shared listener more than once. */
let installPromise = null;

/**
 * Lazily attach ONE `lerret:change` listener to Vite's HMR client and fan its
 * payloads out to every {@link onLerretChange} subscriber. Idempotent.
 *
 * @returns {void}
 */
function ensureInstalled() {
  if (installPromise) return;
  // `/@vite/client` is a dev-server-only URL; `@vite-ignore` keeps `vite build`
  // from trying to resolve it (it would fail the build otherwise) and leaves it
  // as a runtime import resolved against the serving dev server.
  installPromise = import(/* @vite-ignore */ '/@vite/client')
    .then((client) => {
      if (!client || typeof client.createHotContext !== 'function') return;
      // A stable, studio-private owner id — distinct from any real module path
      // so Vite never prunes it.
      const hot = client.createHotContext('/@lerret/cli-hmr-bridge');
      hot.on(LERRET_CHANGE_EVENT, (payload) => {
        for (const handler of handlers) {
          try {
            handler(payload);
          } catch (err) {
            // A throwing subscriber must not break the others or the live loop.
            console.error('[lerret] lerret:change subscriber threw:', err);
          }
        }
      });
    })
    .catch(() => {
      // No HMR client (static host / no dev server). Live edit is simply
      // unavailable here — not an error.
    });
}

/**
 * Subscribe to the CLI's `lerret:change` live-edit event in a way that survives
 * `vite build` (works from the pre-built `dist-studio` bundle, not just source).
 *
 * @param {(payload: { event: { type: string, path: string }, project?: object | null, cascadeEntries?: Array<[string, object]> }) => void} handler
 *   Called with each event's payload (the object the CLI plugin sends).
 * @returns {() => void} Unsubscribe — removes this handler. The shared HMR
 *   listener stays installed (cheap; the studio is a single long-lived SPA).
 */
export function onLerretChange(handler) {
  if (typeof handler !== 'function') return () => {};
  handlers.add(handler);
  ensureInstalled();
  return () => {
    handlers.delete(handler);
  };
}
