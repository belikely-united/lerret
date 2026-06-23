// sitemap.xml generation for the Lerret docs site.
//
// Statically exported (Next.js `output: 'export'` honours this file at build
// time and writes `sitemap.xml` into the `out/` directory). Algolia DocSearch
// uses it to discover crawl targets.

export const dynamic = 'force-static';

const BASE = 'https://docs.lerret.belikely.com';

const ROUTES = [
  '',
  '/getting-started',
  '/concepts',
  '/authoring',
  '/examples',
  '/studio',
  '/cli',
  '/deploy',
  '/ai-studio',
  '/ai-editing',
  '/faq',
];

export default function sitemap() {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: `${BASE}${route}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: route === '' ? 1.0 : 0.8,
  }));
}
