# Self-hosting the Lerret studio

The Lerret studio is a fully client-side static SPA — no backend, no database,
no account. Your project files never leave your machine (NFR6). You can serve
the same studio that runs at `lerret.belikely.com` from any static web server
or CDN you control.

---

## Requirements

### Supported browsers

The hosted studio requires the **File System Access API** and **Service
Workers**, both of which are available in Chromium-based browsers (Chrome 86+,
Edge 86+, Arc, Brave, etc.). Firefox and Safari do not support the File System
Access API and will show an "Unsupported browser" screen.

### Secure context (HTTPS or localhost)

The File System Access API and Service Workers require a **secure context**:

- **HTTPS** — any origin served over TLS works.
- **`localhost`** — browsers treat `http://localhost` as a secure context
 regardless of TLS, so local smoke-testing works without a certificate.
- **`http://` on a non-localhost domain** — this is NOT a secure context.
 Folder access will silently fail and the service worker cannot register.
 Deploy to HTTPS before sharing a self-hosted instance.

---

## Build

Install dependencies and build the studio:

```sh
# From the repo root
pnpm install
pnpm --filter @lerret/studio build
```

The output is written to `packages/studio/dist/`. It is self-contained — copy
the entire `dist/` directory to your host. The directory structure is:

```
dist/
 index.html # Entry page; auto-sets hosted-mode flag at load
 module-sw.js # Service worker (stable name, top-level — required)
 assets/ # Hashed JS/CSS chunks and static images
```

The service worker (`module-sw.js`) is intentionally at the root (alongside
`index.html`), not inside `assets/`. Its scope must cover the same directory
as the page so it can intercept the asset-module fetches the hosted runtime
issues at runtime.

---

## Serving

### Domain root

Any static server works. Examples:

```sh
# npx serve (Node.js)
npx serve packages/studio/dist

# Python built-in
python3 -m http.server 5000 --directory packages/studio/dist

# Caddy (production)
caddy file-server --root packages/studio/dist --listen :443
```

Open `http://localhost:5000/` (or your HTTPS domain). The studio boots
directly into the open-folder empty state. Pick a folder that contains a valid
`.lerret/` project and the canvas loads.

### Sub-path (e.g. `https://my-site.com/lerret/`)

The build uses **relative asset URLs** (`./assets/…` in `index.html`) so it
works at any sub-path without rebuilding. Upload the entire `dist/` directory
to the sub-path on your CDN/server.

Example with nginx:

```nginx
location /lerret/ {
 root /var/www; # serves files from /var/www/lerret/
 try_files $uri $uri/ /lerret/index.html;
}
```

Upload `dist/` as `/var/www/lerret/` (so `index.html` is at
`/var/www/lerret/index.html` and `module-sw.js` at
`/var/www/lerret/module-sw.js`).

The service worker URL is derived from `import.meta.env.BASE_URL` at build
time (which becomes `./` with the current config). When the page loads from
`https://my-site.com/lerret/`, `./module-sw.js` resolves to
`https://my-site.com/lerret/module-sw.js` — the correct location — and the
SW scope is `https://my-site.com/lerret/`, covering the studio page.

### CDN upload (e.g. Firebase Hosting, Cloudflare Pages, S3 + CloudFront)

Upload the contents of `dist/` to the bucket/project root (or sub-folder).
No server-side code is required. Configure the CDN to serve `index.html` for
all unmatched paths (SPA routing).

---

## Smoke test

After serving, confirm the studio works:

1. Open `http://localhost:<port>/` in Chrome (or a Chromium-based browser).
2. You should see the Lerret logo and an **"Open folder"** button — the hosted
 empty state.
3. Click **Open folder** and pick a directory that contains a `.lerret/`
 project (or any directory — the studio will show an error if no project is
 found, but the open-folder screen itself confirms the build is working).

Sub-path smoke:

1. Serve with a sub-path (e.g. `npx serve packages/studio/dist --base /lerret/`
 or configure nginx as above).
2. Open `http://localhost:<port>/lerret/`.
3. The same open-folder screen should appear, confirming the service-worker
 scope and relative asset URLs both work at a sub-path.

---

## How it works (architecture notes)

- **No backend.** The studio reads your `.lerret/` folder through the browser's
 File System Access API. Files never leave your machine.
- **Service worker.** `module-sw.js` intercepts dynamic `import()` calls for
 transformed asset modules. The main thread reads your `.jsx`/`.tsx` files via
 the FSA, transforms them with Sucrase in-browser, and pre-registers the
 result with the SW. The SW serves the cached source at a predictable URL so
 the browser's module system can load it. This is why the service worker must
 be at the root alongside `index.html`.
- **Relative URLs.** The build uses `base: './'` in Vite's config so all asset
 references in `index.html` are relative. This makes the bundle portable to
 any path — domain root or sub-folder — without a rebuild.
- **Hosted-mode flag.** The built `index.html` includes an inline
 `<script>globalThis.__LERRET_HOSTED_MODE__ = true;</script>` (injected by the
 build plugin). This signals the studio's entry layer to boot into hosted mode
 (FSA picker + Sucrase runtime) rather than the CLI or fixture mode.

---

## Phase-2 documentation

A full self-host guide in the Lerret documentation site (Docusaurus) is tracked
as Phase-2 work. This file covers the essentials to get a build running — the
docs site will add more context, troubleshooting, and deployment recipes.
