// Nextra wraps Next.js with MDX rendering, content map generation, and theme
// integration. We use the App Router (Nextra 4 default) and static export so
// the site can deploy to Firebase Hosting (or any static host) without an
// origin server.

import nextra from 'nextra';

const withNextra = nextra({
  // Default content directory is `content/` at the project root.
});

export default withNextra({
  output: 'export',
  images: {
    // next/image's default loader needs a server; the static export disables it.
    unoptimized: true,
  },
  // The trailing slash matters for static-host routing under Firebase.
  trailingSlash: true,
  // The workspace's flat ESLint config does not include React / browser globals
  // for apps/docs/**, so Next's lint step flags valid JSX as unused. The docs
  // project is intentionally outside the workspace lint surface; it will get
  // its own eslint config later.
  eslint: {
    ignoreDuringBuilds: true,
  },
});
