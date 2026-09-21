# Lerret — working notes

Guidance for Claude Code (and anyone else) working in this repo. Conventions
that are visible from the code itself are not repeated here; this file records
the things that are **not** derivable by reading the source.

## Releasing to npm

**Bump the version in the package's `package.json`, merge to `main`. That is
the whole process.** Do not publish by hand.

`.github/workflows/release.yml` runs on every push to `main` that touches a
`packages/*/package.json`, and publishes any package whose version is not yet
on the registry. A merge that doesn't change a version is a green no-op. There
is no tag to push and no button to press — the version field *is* the release
intent.

Authentication is npm **Trusted Publishing (OIDC)**: GitHub mints a
short-lived, workflow-scoped credential per run. There is no token in the repo,
in CI secrets, or on anyone's laptop.

`workflow_dispatch` (Actions → Release → Run workflow) remains for retrying a
release without a new commit, or publishing one package deliberately.

### Things that will bite you

- **Never `npm publish` from a package folder.** Packages depend on siblings
  with `workspace:^`, and plain npm ships that specifier verbatim — every
  `npm i @lerret/cli` then fails to resolve it. The workflow uses `pnpm pack`
  (which rewrites it to a real semver range) and then `npm publish <tarball>`
  (which speaks OIDC). Both halves are required; the `Verify tarball` step
  fails the run if a `workspace:` specifier survives, because that breakage is
  invisible until a user installs.
- **`pnpm publish` cannot be used in CI.** pnpm only gained OIDC support in
  v11, and this repo pins pnpm 9.15.0. Bumping that major invalidates the
  lockfile across every job.
- **Do not rename `release.yml`.** npm's trusted-publisher config is pinned to
  that exact filename, per package, and those fields are frozen once created.
  Renaming the file means deleting and recreating the config for
  `@lerret/cli`, `@lerret/core`, and `create-lerret`.
- **Manual publishing is a broken path, not a fallback.** The npm account uses
  a **passkey** second factor, so there is no 6-digit OTP for `--otp`, and the
  old bypass-2FA token is dead (npm is restricting that whole token class). If
  you ever must publish by hand it is `pnpm pack` then
  `npm publish <tarball> --access public`, which opens a browser for the
  passkey — but prefer fixing the workflow.

## CI signals worth knowing

- **`Lint & Test` is the gate.** `Smoke (ubuntu/macos)` matter too.
- **`Cold-run benchmark` has been red on `main` since before Sept 2026** and is
  marked `continue-on-error: true`, so the workflow still reports green. It
  fails because CI never builds `dist-studio`, so the benchmark serves the
  studio from source and exceeds its 45s startup budget. Do not read a red
  benchmark as a regression from your change without checking `main` first.

## The studio bundle

- `@lerret/cli dev` serves the **pre-built** `dist-studio/`, not live source.
  After changing anything under `packages/studio/src`, run
  `pnpm --filter @lerret/cli build` before browser-verifying, or you are
  testing stale code.
- `dist-studio/` is gitignored and rebuilt by `prepublishOnly`.
- Bugs that only appear when `dist-studio/` is served from inside
  `node_modules/` (i.e. the published CLI) are invisible in this repo, where it
  is not. `packages/cli/src/dist-studio-node-modules.smoke.test.js` stages the
  real bundle under a `node_modules/` path specifically to catch that class.
  Run the browser smokes with `pnpm --filter @lerret/cli test:smoke`.

## Studio ↔ CLI data contract

The studio cannot stat the filesystem. Anything it would otherwise discover by
probing — and 404ing — should instead be computed server-side and shipped in
the `virtual:lerret-project` module, then refreshed on the `lerret:change` HMR
event. `assetConfigEntries` and `assetDataEntries` are the two existing
examples; follow that pattern rather than adding a new blind probe.
