// spreadsheet.test.js — CSV + .xlsx reading for the workflow's data node.

import { describe, expect, it } from 'vitest';

import { parseCsv, parseXlsx, toTable, columnIndex, readSpreadsheet } from './spreadsheet.js';

const enc = (s) => new TextEncoder().encode(s);

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines in fields, CRLF and a BOM', () => {
    const csv = '\uFEFFName,Team,Note\r\n"Sharma, Priya",Design,"says ""hi"""\r\n"Lee\nKim",Ops,\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Team', 'Note'],
      ['Sharma, Priya', 'Design', 'says "hi"'],
      ['Lee\nKim', 'Ops', ''],
    ]);
  });

  it('detects a semicolon or tab delimiter from the header row', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('toTable', () => {
  it('takes the first row as headers, names blanks, pads rows, drops empty rows', () => {
    expect(toTable('x.csv', [['Name', ''], ['Ana'], ['', ''], ['Bo', '3', 'extra']])).toEqual({
      name: 'x.csv',
      headers: ['Name', 'Column 2', 'Column 3'],
      rows: [['Ana', '', ''], ['Bo', '3', 'extra']],
    });
    expect(() => toTable('e.csv', [['', '']])).toThrow(/no data/);
  });
});

describe('parseXlsx', () => {
  const files = {
    'xl/workbook.xml': enc(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Winners" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': enc(
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><t>Score</t></si><si><r><t>Priya </t></r><r><t>Sharma</t></r></si></sst>',
    ),
    'xl/worksheets/sheet1.xml': enc(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>97.5</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>Bo</t></is></c><c r="C3" t="b"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    ),
  };

  it('reads the first sheet: shared + rich + inline strings, numbers, booleans, gaps', () => {
    const rows = parseXlsx(new Uint8Array(), { unzip: () => files });
    expect(rows).toEqual([
      ['Name', '', 'Score'],
      ['Priya Sharma', '', '97.5'],
      ['Bo', '', 'TRUE'],
    ]);
  });

  it('maps cell references to column indexes', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AB3')).toBe(27);
  });
});

describe('readSpreadsheet', () => {
  it('reads CSV files and refuses legacy .xls and other files', async () => {
    const csv = new File(['Name\nAna\nBo\n'], 'winners.csv', { type: 'text/csv' });
    expect(await readSpreadsheet(csv)).toEqual({ name: 'winners.csv', headers: ['Name'], rows: [['Ana'], ['Bo']] });
    await expect(readSpreadsheet(new File(['x'], 'old.xls'))).rejects.toThrow(/xlsx or CSV/);
    await expect(readSpreadsheet(new File(['x'], 'notes.txt'))).rejects.toThrow(/Excel/);
  });
});
