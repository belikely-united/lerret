# create-lerret

> Scaffolder for new [Lerret](https://github.com/belikely-united/lerret) projects — an open-source design canvas where a folder of React component files renders as a visual canvas.

[![npm](https://img.shields.io/npm/v/create-lerret.svg)](https://www.npmjs.com/package/create-lerret)
[![License: MIT](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/belikely-united/lerret/blob/main/LICENSE)

## Usage

```sh
npx create-lerret@latest my-canvas
cd my-canvas
npx @lerret/cli@latest dev
```

Or with other runners:

```sh
pnpm dlx create-lerret@latest my-canvas
yarn dlx create-lerret@latest my-canvas
bunx create-lerret@latest my-canvas
```

## Options

```sh
create-lerret <project-name>            # full scaffold with sample assets
create-lerret <project-name> --no-samples   # minimal empty project
```

## What it produces

```
my-canvas/
└── .lerret/
    ├── config.json
    ├── _fonts/
    │   └── LerretFixtureMono.woff2
    └── social/
        ├── twitter-banner.jsx
        ├── instagram-square.jsx
        └── youtube-thumbnail.jsx
```

Each `.jsx` under `.lerret/` is an asset that renders as an artboard in the studio.

## Source & docs

- Source: [github.com/belikely-united/lerret](https://github.com/belikely-united/lerret) (`packages/create-lerret/`)
- Documentation: [docs.lerret.belikely.com](https://docs.lerret.belikely.com)

## License

[MIT](https://github.com/belikely-united/lerret/blob/main/LICENSE)
