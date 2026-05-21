// robots.txt generation for the Lerret docs site.
//
// Statically exported (Next.js `output: 'export'` honours this file at build
// time and writes `robots.txt` into the `out/` directory).

export const dynamic = 'force-static';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: 'https://docs.lerret.belikely.com/sitemap.xml',
  };
}
