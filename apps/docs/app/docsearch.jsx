'use client';

// Algolia DocSearch entry point for the Lerret docs site. Replaces Nextra's
// default Pagefind-backed `<Search />` slot. The crawler is configured at
// Algolia (index: `lerret-docs`) and refreshes from the deployed site.
//
// The appId / indexName / apiKey below are the search-only credentials Algolia
// publishes for DocSearch — they ship to the browser by design and have
// read-only scope. Do not move them to env / secret manager.

import { DocSearch } from '@docsearch/react';
import '@docsearch/css';

export default function LerretDocSearch() {
  return (
    <DocSearch
      appId="JEU3MB4OIP"
      indexName="lerret-docs"
      apiKey="e078ec7574f66fe4ebaaa69ce90f2d9e"
    />
  );
}
