// react-jsx-runtime-instance.js — the hosted import map's `react/jsx-runtime`
// target. Sucrase's automatic runtime emits `import { jsx, jsxs } from
// "react/jsx-runtime"`, so these must resolve to the studio's instance.
// Explicit names (see react-instance.js for why `export *` won't do).
// (Epic 10 / Story H1.2.)
export { Fragment, jsx, jsxs } from 'react/jsx-runtime';
