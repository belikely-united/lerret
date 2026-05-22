# Contributing to Lerret

Thanks for your interest in helping build Lerret. This document covers everything you need to make your first contribution.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behavior privately (see SECURITY.md for the contact).

## Ways to contribute

- **Report bugs** — open an issue using the bug-report template.
- **Propose features** — open an issue using the feature-request template, or start a discussion first if the change is large.
- **Improve docs** — typos, clarifications, examples — all welcome.
- **Submit code** — pick an open issue labelled `good first issue` or `help wanted`, or propose your own.
- **Design and brand** — improvements to the visual language, marketing assets, icons.
- **Translate** — once internationalization lands, translation contributions will be tracked separately.

## Reporting issues

Before opening a new issue, search existing issues to avoid duplicates. Use the templates in `.github/ISSUE_TEMPLATE/` — they prompt for everything we need (version, steps to reproduce, expected vs. actual behavior, environment).

For security issues, **do not open a public issue.** Follow the process in [SECURITY.md](SECURITY.md).

## Proposing changes

For non-trivial changes (new features, refactors, dependency upgrades, public API changes) **open a Discussion or issue first.** Get rough alignment before writing code — it saves everyone time.

Small fixes (typos, one-liner bugs, doc clarifications) can go straight to a PR.

## Zero-install (end users)

You do not need to clone this repo to use Lerret. Pick the package runner you already have:

```sh
# npm
npx create-lerret@latest my-project
cd my-project && npx @lerret/cli@latest dev

# pnpm
pnpm dlx create-lerret@latest my-project
cd my-project && pnpm dlx @lerret/cli@latest dev

# yarn
yarn dlx create-lerret@latest my-project
cd my-project && yarn dlx @lerret/cli@latest dev

# bun
bunx create-lerret@latest my-project
cd my-project && bunx @lerret/cli@latest dev
```

Flags work identically across all four runners:

```sh
# Minimal project (no sample assets)
npx create-lerret@latest my-project --no-samples

# Export to a specific directory
npx @lerret/cli@latest export --out ./dist --format png

# Custom dev-server port
npx @lerret/cli@latest dev --port 4321
```

## Local setup (contributors)

```bash
# 1. Fork the repo on GitHub
# 2. Clone your fork
git clone https://github.com/<your-username>/lerret.git
cd lerret

# 3. Install dependencies (pnpm is the workspace's package manager)
pnpm install

# 4. Run the studio against the workspace's sample project
pnpm dev                           # equivalent to: pnpm --filter @lerret/studio dev

# 5. Build everything (studio, CLI's bundled studio, etc.)
pnpm build

# 6. Run the full test suite
pnpm test
```

The repo is a [pnpm workspace](https://pnpm.io/workspaces). Each package under `packages/` and each app under `apps/` is independently buildable. Use `pnpm --filter <name> <script>` to act on a single package.

## Pull request process

1. Branch from `main` using the naming convention in [Branch naming](#branch-naming) below.
2. Make your change. Keep commits focused — one logical change per commit.
3. Follow the commit conventions below.
4. Add or update tests where it makes sense.
5. Update relevant docs (and the `## [Unreleased]` section in `CHANGELOG.md` if user-visible).
6. Push to your fork and open a PR against `belikely-united/lerret:main`.
7. Fill out the PR template — every checkbox.
8. Wait for CI to pass and at least one maintainer review. Address comments by pushing additional commits (don't force-push during review).

## Coding standards

- Match the existing style of the file you're editing.
- Prefer clarity over cleverness.
- Run the linter and formatter before pushing:

  ```sh
  pnpm lint           # ESLint across the workspace
  pnpm format         # Prettier write — formats in place
  pnpm format:check   # Prettier check — non-zero exit on diff (used in CI)
  ```

- Run tests for the packages you touched:

  ```sh
  pnpm test                              # full workspace test run
  pnpm --filter @lerret/cli test         # just the CLI
  pnpm --filter @lerret/studio test      # just the studio
  ```

  All tests run on [Vitest 4](https://vitest.dev/). The studio package uses jsdom; the CLI and core use the default Node environment.

## Commit conventions

We follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`.

**Examples:**

```
feat(canvas): add 4:5 preset for vertical posts
fix(export): handle Unicode filenames on Windows
docs: clarify the .lerret JSON layer schema
```

This unlocks automatic changelog generation and semver-based releases. Enforced via commitlint in CI.

## Branch naming

```
feat/<short-name>     # new features
fix/<short-name>      # bug fixes
docs/<short-name>     # documentation
chore/<short-name>    # tooling, deps
```

Lowercase, hyphens, descriptive — `feat/png-export-scale` not `feat/MyChange`.

## Performance budget (NFR1)

Lerret's first-run experience must be fast. **NFR1** requires that a brand-new user reaches a rendered canvas within **60 seconds** of running `npx create-lerret@latest` on a cold machine (no Lerret packages cached) over typical broadband.

### What the 60 seconds covers

| Phase | What happens |
|---|---|
| `npx create-lerret@latest my-project` | Runner downloads `create-lerret` from the registry, extracts it, and scaffolds the project tree. |
| `npx @lerret/cli@latest dev` | Runner downloads `@lerret/cli` (+ Vite + React), starts the Vite dev server. |
| Canvas ready | Browser receives an HTTP 200 response with the studio HTML. |

The dominant cost is downloading Vite and its peer dependencies (~4 MB gzipped on first install). The `create-lerret` package itself has **zero runtime dependencies** and the `@lerret/cli` CLI keeps its own dependency surface minimal.

### Running the benchmark locally

```sh
bash scripts/cold-run-benchmark.sh
```

The script:
1. Clears each runner's download cache (npm, pnpm, yarn, bun) — safely, only the tool-specific subdirectories.
2. Packs `create-lerret` into a local tarball (simulates zero-install without a registry publish).
3. Times the scaffold step per runner.
4. Times `@lerret/cli dev --no-open` startup until Vite prints its listening URL.
5. Writes per-runner timings to `scripts/cold-run-results.json`.
6. Exits non-zero if any runner's total exceeds the threshold (60 s locally, 90 s in CI).

> **Warm-cache caveat:** In a local environment the workspace `node_modules` (Vite, React) are already present. The benchmark measures scaffold + dev-server startup but does NOT simulate downloading Vite cold. CI is the authoritative source of truth for the full cold-run NFR because CI runners start from a clean state.

### CI benchmark

The `cold-run-benchmark` job in `.github/workflows/zero-install.yml` runs on `ubuntu-latest` and `macos-latest` on every push and PR that touches `packages/cli`, `packages/create-lerret`, or the benchmark scripts. It uses a 90 s threshold (vs 60 s locally) to absorb CI-runner variability, and uploads `cold-run-results.json` as a workflow artifact for 30 days. The job is marked `continue-on-error: true` so a single slow host doesn't block a merge, but persistent breaches indicate a packaging regression.

### Keeping the budget

- Do not add runtime dependencies to `create-lerret` (it has zero). Any new helper must be implemented in Node built-ins or plain JS.
- Keep the `@lerret/cli` CLI's dependency surface minimal. Adding a new runtime dependency requires a budget review — check that the total install size (gzipped) does not meaningfully increase.
- The studio bundle (`dist-studio/`) is pre-built and shipped inside the `@lerret/cli` package. Its size is bounded by the React + Vite runtime (~200 KB gzipped). Adding studio dependencies requires updating the bundle size estimate in this section.

### No-network behavior

`create-lerret` and `@lerret/cli` are designed to **fail fast** when no network is available rather than hanging indefinitely:

- **`npx create-lerret@latest` (no network):** `npx` itself detects the registry is unreachable and exits with a clear error within the runner's configured timeout (typically 30 s). No Lerret code runs until the package is downloaded.
- **`@lerret/cli dev` (no network):** Once `@lerret/cli` is installed, `@lerret/cli dev` never makes outbound network requests. It starts a local Vite server using only already-installed packages. Offline `@lerret/cli dev` works without any network.
- **Vite's module pre-bundling** is purely local (esbuild transforms files from `node_modules`). No CDN or registry calls during `@lerret/cli dev`.

If you reproduce a hang on no-network, please open an issue — it indicates the runner's timeout is misconfigured, not a Lerret bug.

## License of contributions

By submitting a contribution you agree that it will be released under the project's [MIT license](LICENSE).

---

Questions? Start a [Discussion](https://github.com/belikely-united/lerret/discussions) — that's the project's primary community channel. Welcome aboard.
