// Sidebar / navigation order. Keys map to filenames (without extension) or
// folder names. Strings render as section labels.

export default {
  index: {
    title: 'Introduction',
    theme: { breadcrumb: false },
  },
  'getting-started': 'Getting Started',
  '-- guide': {
    type: 'separator',
    title: 'Guide',
  },
  concepts: 'Concepts',
  authoring: 'Authoring Assets',
  examples: 'Examples',
  studio: 'The Studio',
  cli: 'CLI Reference',
  deploy: 'Deployment',
  '-- ai': {
    type: 'separator',
    title: 'AI',
  },
  'ai-studio': 'AI in the Studio',
  'ai-editing': 'Editing with AI Tools',
  '-- meta': {
    type: 'separator',
    title: 'Meta',
  },
  faq: 'FAQ',
};
