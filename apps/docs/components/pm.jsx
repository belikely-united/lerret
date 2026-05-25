// <PM> — package-manager command switcher.
//
// Author a command block once in its npm/npx form; this renders a Nextra
// <Tabs> with a panel per manager and rewrites each line. The tab choice is
// persisted and synced across every <PM> on the site via Nextra's storageKey
// (writes localStorage + dispatches a storage event the other tabs listen to).
//
//   <PM cmd="npx create-lerret@latest my-canvas" />
//   <PM cmd={`cd my-canvas\nnpx @lerret/cli@latest dev`} />
//
// Lines that are not a Lerret runner invocation (cd, cp, comments, blanks)
// pass through unchanged so mixed shell recipes still work.

import { Tabs, Pre, Code } from 'nextra/components';

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
const STORAGE_KEY = 'lerret-pm';

// Rewrite a single command string for the given manager. Returns the input
// untouched when it is not a recognised Lerret runner invocation.
function rewriteCommand(cmd, pm) {
  // create-lerret scaffolder — canonical "create" form across managers.
  let m = cmd.match(
    /^(?:npx|pnpm dlx|yarn dlx|bunx|npm exec)\s+create-lerret(@\S+)?(\s.*)?$/,
  );
  if (m) {
    const tag = m[1] || ''; // e.g. "@latest"
    const rest = m[2] || ''; // e.g. " my-canvas --no-samples"
    switch (pm) {
      case 'npm':
        return `npm create lerret${tag}${rest}`;
      case 'pnpm':
        return `pnpm create lerret${tag}${rest}`;
      case 'yarn':
        return `yarn create lerret${rest}`; // yarn create resolves latest itself
      case 'bun':
        return `bun create lerret${tag}${rest}`;
    }
  }

  // Run a published Lerret binary — dlx / bunx form.
  m = cmd.match(/^(?:npx|pnpm dlx|yarn dlx|bunx)\s+(@lerret\/\S+)(\s.*)?$/);
  if (m) {
    const pkg = m[1]; // e.g. "@lerret/cli@latest"
    const rest = m[2] || '';
    switch (pm) {
      case 'npm':
        return `npx ${pkg}${rest}`;
      case 'pnpm':
        return `pnpm dlx ${pkg}${rest}`;
      case 'yarn':
        return `yarn dlx ${pkg}${rest}`;
      case 'bun':
        return `bunx ${pkg}${rest}`;
    }
  }

  return cmd;
}

// Split a raw line into a structured form so trailing comments can be
// re-aligned after rewriting (rewritten commands change width per manager).
function parseLine(line) {
  if (/^\s*$/.test(line)) return { kind: 'blank' };
  if (/^\s*#/.test(line)) return { kind: 'comment', text: line };
  const m = line.match(/^(.*\S)\s{2,}#\s?(.*)$/);
  if (m) return { kind: 'cmd', cmd: m[1], comment: m[2] };
  return { kind: 'cmd', cmd: line.replace(/\s+$/, ''), comment: null };
}

const dim = { opacity: 0.55 };

function renderPanel(lines, pm) {
  const rewritten = lines.map((p) =>
    p.kind === 'cmd' ? { ...p, cmd: rewriteCommand(p.cmd, pm) } : p,
  );
  const maxLen = rewritten.reduce(
    (n, p) => (p.kind === 'cmd' && p.comment != null ? Math.max(n, p.cmd.length) : n),
    0,
  );
  const last = rewritten.length - 1;
  return rewritten.map((p, i) => {
    const nl = i < last ? '\n' : '';
    if (p.kind === 'blank') return <span key={i}>{nl}</span>;
    if (p.kind === 'comment')
      return (
        <span key={i}>
          <span style={dim}>{p.text}</span>
          {nl}
        </span>
      );
    if (p.comment != null) {
      const pad = ' '.repeat(maxLen - p.cmd.length + 3);
      return (
        <span key={i}>
          {p.cmd}
          <span style={dim}>
            {pad}# {p.comment}
          </span>
          {nl}
        </span>
      );
    }
    return (
      <span key={i}>
        {p.cmd}
        {nl}
      </span>
    );
  });
}

export function PM({ cmd = '' }) {
  const lines = String(cmd)
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map(parseLine);

  return (
    <Tabs items={MANAGERS} storageKey={STORAGE_KEY}>
      {MANAGERS.map((pm) => (
        <Tabs.Tab key={pm}>
          <Pre data-copy="" data-language="sh">
            <Code data-language="sh">{renderPanel(lines, pm)}</Code>
          </Pre>
        </Tabs.Tab>
      ))}
    </Tabs>
  );
}
