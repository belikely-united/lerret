// Root layout for the docs site. The Nextra theme component (`Layout`) wraps
// every page with navbar, sidebar, TOC, footer, and the breadcrumbs.

import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';

import 'nextra-theme-docs/style.css';

export const metadata = {
  title: {
    default: 'Lerret',
    template: '%s — Lerret',
  },
  description:
    'An open-source design canvas where a folder of plain React component files renders as a visual canvas.',
  metadataBase: new URL('https://docs.lerret.belikely.com'),
};

export default async function RootLayout({ children }) {
  const navbar = (
    <Navbar
      logo={
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>Lerret</span>
      }
      projectLink="https://github.com/belikely-united/lerret"
    />
  );

  const footer = (
    <Footer>
      <span>
        © {new Date().getFullYear()} Lerret · MIT License ·{' '}
        <a href="https://github.com/belikely-united/lerret" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </span>
    </Footer>
  );

  const pageMap = await getPageMap();

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/belikely-united/lerret/tree/main/apps/docs/content"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
