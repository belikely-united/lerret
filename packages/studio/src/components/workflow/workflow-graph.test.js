// workflow-graph.test.js — connection rules, mapping, naming, persistence.

import { describe, expect, it } from 'vitest';

import {
  canConnect,
  connect,
  removeNode,
  inputOf,
  autoMap,
  looksLikePersonName,
  replacementsFor,
  fileNamesFor,
  parseWorkflow,
  workflowPathFor,
} from './workflow-graph.js';
import { buildJpegPdf } from './pdf.js';

const wf = {
  version: 1,
  nodes: [
    { id: 'd', type: 'data', x: 0, y: 0 },
    { id: 'd2', type: 'data', x: 0, y: 0 },
    { id: 'c', type: 'design', x: 0, y: 0 },
    { id: 'p', type: 'preview', x: 0, y: 0 },
    { id: 'dl', type: 'download', x: 0, y: 0 },
  ],
  edges: [],
};

describe('connections', () => {
  it('allows sheet → design → preview/download only', () => {
    expect(canConnect(wf, 'd', 'c')).toEqual({ ok: true });
    expect(canConnect(wf, 'c', 'p')).toEqual({ ok: true });
    expect(canConnect(wf, 'c', 'dl')).toEqual({ ok: true });
    expect(canConnect(wf, 'd', 'p').ok).toBe(false);
    expect(canConnect(wf, 'p', 'c').ok).toBe(false);
  });

  it('gives a design one sheet; connecting another replaces it', () => {
    const one = connect(wf, 'd', 'c');
    expect(canConnect(one, 'd2', 'c').reason).toMatch(/already has an input/);
    const swapped = connect(one, 'd2', 'c');
    expect(inputOf(swapped, 'c').id).toBe('d2');
    expect(swapped.edges).toHaveLength(1);
  });

  it('removing a node removes its edges', () => {
    const g = connect(connect(wf, 'd', 'c'), 'c', 'p');
    expect(removeNode(g, 'c').edges).toEqual([]);
  });
});

describe('autoMap + replacementsFor', () => {
  it('maps a text to the column named like its data field', () => {
    const fields = [{ text: 'Ada Lovelace', prop: 'name' }, { text: 'Best Performer 2026', prop: 'title' }];
    expect(autoMap(fields, ['Name', 'Team'])).toEqual({ 'Ada Lovelace': 'Name' });
  });

  it('picks the placeholder name, never a heading, on a real certificate', () => {
    const fields = ['CERTIFICATE OF EXCELLENCE', 'Best Performer', 'This certificate is proudly presented to', 'John Doe', 'For outstanding performance in Q3 2026', 'Acme Inc. · People Team'].map((text) => ({ text }));
    expect(autoMap(fields, ['Employee Name', 'Department', 'Employee ID'])).toEqual({ 'John Doe': 'Employee Name' });
    expect(looksLikePersonName('Priya Sharma')).toBe(true);
    expect(looksLikePersonName('CERTIFICATE OF EXCELLENCE')).toBe(false);
    expect(looksLikePersonName('Best Performer')).toBe(false);
  });

  it('offers a name-like column to the text that looks like a person', () => {
    const fields = [{ text: 'Certificate of Excellence' }, { text: 'Priya Sharma' }];
    expect(autoMap(fields, ['Employee Name', 'Dept'])).toEqual({ 'Priya Sharma': 'Employee Name' });
    expect(autoMap([{ text: 'Q3 2026' }], ['Score'])).toEqual({});
  });

  it('builds a row\'s replacements', () => {
    expect(replacementsFor({ 'John Doe': 'Name' }, ['Team', 'Name'], ['Ops', 'Priya Sharma'])).toEqual([['John Doe', 'Priya Sharma']]);
  });
});

describe('fileNamesFor', () => {
  it('names files from a column, safely and uniquely, with a numbered fallback', () => {
    const rows = [['Priya Sharma'], ['A/B: Test'], ['Priya Sharma'], ['']];
    expect(fileNamesFor(rows, ['Name'], 'Name', 'Certificate')).toEqual([
      'Priya Sharma',
      'A B Test',
      'Priya Sharma (2)',
      'Certificate 04',
    ]);
    expect(fileNamesFor([['x'], ['y']], ['Name'], undefined, 'Cert')).toEqual(['Cert 01', 'Cert 02']);
  });
});

describe('persistence', () => {
  it('drops malformed nodes and dangling edges', () => {
    const json = JSON.stringify({
      nodes: [{ id: 'a', type: 'data', x: 1, y: 2 }, { id: 'b', type: 'bogus', x: 0, y: 0 }, { id: 'c', type: 'design' }],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(parseWorkflow(json)).toEqual({ version: 1, nodes: [{ id: 'a', type: 'data', x: 1, y: 2 }], edges: [] });
    expect(parseWorkflow('not json')).toEqual({ version: 1, nodes: [], edges: [] });
  });

  it('saves each page beside the project, flattened', () => {
    expect(workflowPathFor('/p/.lerret', '/p/.lerret/awards/2026')).toBe('/p/.lerret/.workflows/awards__2026.json');
  });
});

describe('buildJpegPdf', () => {
  it('writes one page per image, sized to the design, with a valid xref', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildJpegPdf([
      { jpeg, imageWidth: 2000, imageHeight: 1400, width: 1000, height: 700 },
      { jpeg, imageWidth: 2000, imageHeight: 1400, width: 1000, height: 700 },
    ]);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 750 525]');
    expect(text).toContain('/Width 2000 /Height 1400');
    // Every xref entry points at "<n> 0 obj".
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
    const entries = text.slice(xrefAt).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10));
      expect(text.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });
});
