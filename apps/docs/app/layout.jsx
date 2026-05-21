// Root layout for the docs site. The Nextra theme component (`Layout`) wraps
// every page with navbar, sidebar, TOC, footer, and the breadcrumbs.

import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';

import 'nextra-theme-docs/style.css';

const REPO_URL = 'https://github.com/belikely-united/lerret';
const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
const ISSUES_URL = `${REPO_URL}/issues`;
const NPM_URL = 'https://www.npmjs.com/package/@lerret/cli';
const X_URL = 'https://x.com/sooryagangaraj';
const BELIKELY_URL = 'https://github.com/belikely-united';

export const metadata = {
  title: {
    default: 'Lerret',
    template: '%s — Lerret',
  },
  description:
    'An open-source design canvas where a folder of plain React component files renders as a visual canvas.',
  metadataBase: new URL('https://docs.lerret.belikely.com'),
};

const footerLinkStyle = {
  color: 'inherit',
  textDecoration: 'none',
  borderBottom: '1px dotted currentColor',
};

export default async function RootLayout({ children }) {
  const navbar = (
    <Navbar
      logo={
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>Lerret</span>
      }
      projectLink={REPO_URL}
      chatLink={DISCUSSIONS_URL}
      chatIcon={
        <span aria-label="Discussions" title="Discussions" style={{ fontSize: '1rem' }}>
          💬
        </span>
      }
    />
  );

  const footer = (
    <Footer>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          width: '100%',
          fontSize: '0.875rem',
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem',
            opacity: 0.85,
          }}
        >
          <a href={REPO_URL} target="_blank" rel="noreferrer" style={footerLinkStyle}>
            GitHub
          </a>
          <a href={DISCUSSIONS_URL} target="_blank" rel="noreferrer" style={footerLinkStyle}>
            Discussions
          </a>
          <a href={ISSUES_URL} target="_blank" rel="noreferrer" style={footerLinkStyle}>
            Issues
          </a>
          <a href={NPM_URL} target="_blank" rel="noreferrer" style={footerLinkStyle}>
            npm
          </a>
          <a href={X_URL} target="_blank" rel="noreferrer" style={footerLinkStyle}>
            X (@sooryagangaraj)
          </a>
          <a href="https://lerret.belikely.com" target="_blank" rel="noreferrer" style={footerLinkStyle}>
            lerret.belikely.com
          </a>
        </div>
        <div style={{ opacity: 0.65, fontSize: '0.8125rem' }}>
          © {new Date().getFullYear()} Lerret · MIT License · Built openly by{' '}
          <a href={BELIKELY_URL} target="_blank" rel="noreferrer" style={footerLinkStyle}>
            Belikely United
          </a>
          .
        </div>
      </div>
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
          docsRepositoryBase="https://github.com/belikely-united/lerret/tree/main/public/apps/docs/content"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
