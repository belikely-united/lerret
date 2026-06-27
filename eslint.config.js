// Shared ESLint flat config — applies to every package in the workspace.
//
// Deliberately reasonable, not punishing: the brownfield studio is large and
// inline-style-heavy, and migrating it must not turn lint into a wall of
// errors. Stylistic findings are `warn`; only genuine bugs are `error`.
// `pnpm lint` is expected to pass (warnings allowed) on the migrated code.

import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // Never lint build output or dependencies.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // CLI-specific build output dirs. dist-studio/ is the bundled studio
      // copy inside packages/cli/; dist-cli/ is the intermediate studio build
      // output inside packages/studio/ before being copied.
      '**/dist-studio/**',
      '**/dist-cli/**',
      '**/build/**',
      '**/coverage/**',
      // The docs site is an isolated Next.js + Nextra project under apps/.
      // It carries its own lint surface via Next; the workspace's flat
      // config does not apply React / browser globals to it.
      'apps/docs/**',
    ],
  },

  // Baseline recommended rules for all JS/JSX.
  js.configs.recommended,

  // Project-wide language options + relaxed shared rules.
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      // The brownfield code has intentional empty catches (best-effort
      // persistence / font embed). Allow them when they have a body comment.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Stylistic / cleanliness — warn so migrated code still passes.
      'no-unused-vars': [
        'warn',
        { args: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },

  // Browser packages — React studio. React + React-Hooks plugins live here.
  {
    files: ['packages/studio/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // New JSX transform + Vite — no `import React` needed for JSX itself,
      // though the brownfield files still import it for `React.*` API calls.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // The brownfield studio is heavily inline-styled and untyped; these
      // would flood the migration with noise. Off, not error.
      'react/prop-types': 'off',
      'react/no-unknown-property': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'off',
      // eslint-plugin-react-hooks v7 ships a much stricter `recommended`
      // preset. Several of these rules flag long-standing, working patterns in
      // the brownfield canvas (setState inside effects, a helper component
      // declared inside a render, a useMemo dep list with a derived key).
      // The module/build-wiring migration explicitly must NOT rewrite studio
      // React logic — so these are surfaced as warnings (still visible, still
      // actionable later) rather than blocking errors.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/refs': 'warn',
      // v7 also adds `immutability` and `purity`. These flag long-standing
      // brownfield patterns (a mutated ref-ish value; a demo asset that reads
      // `Date.now()` in render). Surfaced as warnings like the rules above —
      // the migration must not rewrite studio React logic.
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      // The brownfield `dcSafeFilename` regex deliberately strips ASCII
      // control chars (\x00-\x1F) from export filenames — a real sanitizer,
      // not a mistake. Warn so it stays visible without blocking.
      'no-control-regex': 'warn',
    },
  },

  // Node packages — CLI + scaffolder.
  {
    files: ['packages/cli/**/*.{js,jsx}', 'packages/create-lerret/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // The separation invariant: the filesystem is reached ONLY through the
  // `core` `FilesystemAccess` abstraction. No
  // subsystem imports the `fs` family directly — only the two backends do.
  // This rule bans `fs` / `node:fs` / `fs/promises` everywhere; the override
  // immediately below re-permits it for the single Node backend file.
  // `node:path`, `node:os`, `node:util`, etc. are intentionally NOT
  // restricted — only the `fs` family is gated.
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'fs',
              message:
                'Do not import `fs` directly. Use the `core` FilesystemAccess abstraction; only packages/cli/src/fs/node-backend.js may touch `fs`.',
            },
            {
              name: 'node:fs',
              message:
                'Do not import `node:fs` directly. Use the `core` FilesystemAccess abstraction; only packages/cli/src/fs/node-backend.js may touch `fs`.',
            },
            {
              name: 'fs/promises',
              message:
                'Do not import `fs/promises` directly. Use the `core` FilesystemAccess abstraction; only packages/cli/src/fs/node-backend.js may touch `fs`.',
            },
            {
              name: 'node:fs/promises',
              message:
                'Do not import `node:fs/promises` directly. Use the `core` FilesystemAccess abstraction; only packages/cli/src/fs/node-backend.js may touch `fs`.',
            },
          ],
        },
      ],
    },
  },

  // Sanctioned exceptions to the `fs` ban:
  //  - packages/cli/src/fs/node-backend.js — the Node `fs` backend IS the
  //    `fs` adapter, so it must import the `fs` family.
  //  - test files — tests stand up on-disk fixtures and the core-purity test
  //    scans the source tree; they are not shipped subsystems, so the
  //    separation invariant does not apply to them.
  //  - vite.config.js — build configuration (Node.js tool context). The self-
  //    host packaging plugin copies module-sw.js to the dist root at build
  //    time; this is purely a tool operation, not studio production code, so
  //    the separation invariant does not apply.
  // Re-stating the rule `off` for these paths lifts the ban here only,
  // without weakening it for any production source file.
  {
    files: [
      'packages/cli/src/fs/node-backend.js',
      // The bundle script copies studio assets at publish time. It is a build
      // tool (not production CLI code) and must use `node:fs` directly — the
      // `FilesystemAccess` abstraction is for user project files.
      'packages/cli/scripts/bundle-studio.js',
      // @lerret/ai's bundle-size measurement script is a Node build tool (not
      // production code) and reads the built output via node:fs directly.
      'packages/ai/scripts/measure-bundle.js',
      // The bin entry points use `realpathSync` to resolve symlinks when
      // comparing process.argv[1] to import.meta.url. This is required for
      // zero-install runners (pnpm dlx, npx, bunx) that place the package
      // behind a symlink in their cache directory. The restriction is
      // intentionally lifted only for these two entry point files — not for
      // any other CLI module.
      'packages/cli/src/lerret.js',
      'packages/create-lerret/src/create-lerret.js',
      '**/*.{test,spec}.{js,jsx}',
      '**/vite.config.js',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // core is environment-agnostic — neither browser nor Node globals.
  {
    files: ['packages/core/**/*.{js,jsx}'],
    languageOptions: {
      globals: {},
    },
  },

  // @lerret/animation runs in the browser (Canvas, Blob, OffscreenCanvas,
  // VideoEncoder, setTimeout). Exposes only frame-capture + encoders; reached
  // exclusively via dynamic import from @lerret/studio and @lerret/cli.
  {
    files: ['packages/animation/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, VideoEncoder: 'readonly', VideoFrame: 'readonly' },
    },
  },

  // @lerret/ai runs browser-direct (BYOK: Web Crypto, fetch, indexedDB,
  // TextEncoder/Decoder, structuredClone, AbortController, ReadableStream) and
  // also ships a Node build script (scripts/measure-bundle.js) plus
  // node/browser test helpers. Give it both global sets, mirroring the
  // test-file block below. No React/JSX here — pure logic, so no react plugin.
  {
    files: ['packages/ai/**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Test files — Vitest globals.
  {
    files: ['**/*.{test,spec}.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // The studio's own config / build files run in Node.
  {
    files: ['**/vite.config.js', '**/vitest.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Repo-level scripts (smoke tests, tooling helpers). Shell scripts are
  // not linted by ESLint; any .mjs helpers here run in Node.
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
