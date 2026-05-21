// Nextra requires an `mdx-components` module at the project root that hands
// MDX rendering the theme's component overrides (callouts, code blocks, the
// page wrapper that renders the TOC + breadcrumbs, etc).

import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs';

const docsComponents = getDocsMDXComponents();

export function useMDXComponents(components) {
  return {
    ...docsComponents,
    ...components,
  };
}
