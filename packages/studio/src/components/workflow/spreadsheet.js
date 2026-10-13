// spreadsheet.js — read a dropped Excel (.xlsx) or CSV file into a table.
//
// No spreadsheet library: an .xlsx is a ZIP of XML parts, and fflate (already
// in the bundle for exports) unzips it. We read the FIRST worksheet — shared
// strings, inline strings, numbers, booleans — and treat its first non-empty
// row as the column headers. Legacy binary .xls is not supported (re-save it
// as .xlsx or CSV).

import { unzipSync } from 'fflate';

/**
 * @typedef {object} Table
 * @property {string} name      The file name.
 * @property {string[]} headers Column names (blank headers become "Column N").
 * @property {string[][]} rows  Data rows, each aligned to `headers`, all strings.
 */

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, newlines inside
 * quotes; comma, semicolon or tab delimiter — whichever the header row uses).
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** `A` → 0, `Z` → 25, `AA` → 26 … from a cell reference like `AB12`. */
export function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(String(ref ?? ''))?.[0]?.toUpperCase() || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const text = (bytes) => new TextDecoder().decode(bytes);
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
/** Elements by local name, ignoring XML namespaces. */
const byName = (node, name) => [...node.getElementsByTagNameNS('*', name)];

/** Format a numeric cell for display (keeps integers clean, trims float noise). */
function formatNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

/**
 * Read the first worksheet of an .xlsx file.
 *
 * @param {Uint8Array} bytes
 * @param {{ unzip?: (bytes: Uint8Array) => Record<string, Uint8Array> }} [deps]
 * @returns {string[][]}
 */
export function parseXlsx(bytes, { unzip = unzipSync } = {}) {
  const files = unzip(bytes);
  const get = (path) => files[path] || files[path.replace(/^\//, '')];

  // workbook → first sheet's relationship id → its part path
  const wb = xml(text(get('xl/workbook.xml')));
  const firstSheet = byName(wb, 'sheet')[0];
  if (!firstSheet) throw new Error('This workbook has no sheets.');
  const rid =
    firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
    firstSheet.getAttribute('r:id');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const relsBytes = get('xl/_rels/workbook.xml.rels');
  if (relsBytes && rid) {
    const rel = byName(xml(text(relsBytes)), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }

  const sharedBytes = get('xl/sharedStrings.xml');
  const shared = sharedBytes
    ? byName(xml(text(sharedBytes)), 'si').map((si) => byName(si, 't').map((t) => t.textContent).join(''))
    : [];

  const sheetBytes = get(sheetPath);
  if (!sheetBytes) throw new Error('Couldn’t find the first sheet in this workbook.');
  const rows = [];
  for (const r of byName(xml(text(sheetBytes)), 'row')) {
    const out = [];
    for (const c of byName(r, 'c')) {
      const idx = columnIndex(c.getAttribute('r'));
      const type = c.getAttribute('t');
      const v = byName(c, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = byName(c, 't').map((t) => t.textContent).join('');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = v;
      else value = v === '' ? '' : formatNumber(v);
      while (out.length < idx) out.push('');
      out[idx] = value;
    }
    rows.push(out);
  }
  return rows;
}

/**
 * Turn raw rows into a table: drop fully empty rows, take the first row as
 * headers (blank → "Column N"), pad/trim every row to the header width.
 *
 * @param {string} name
 * @param {string[][]} raw
 * @returns {Table}
 */
export function toTable(name, raw) {
  const rows = raw.map((r) => r.map((v) => String(v ?? '').trim())).filter((r) => r.some((v) => v !== ''));
  if (rows.length === 0) throw new Error('This file has no data.');
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => rows[0][i] || `Column ${i + 1}`);
  const body = rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return { name, headers, rows: body };
}

/** Whether a file looks like a spreadsheet we can read. */
export function isSpreadsheetFile(file) {
  return /\.(xlsx|csv|tsv)$/i.test(String(file?.name ?? ''));
}

/**
 * Read a dropped file into a table.
 *
 * @param {File} file
 * @returns {Promise<Table>}
 */
export async function readSpreadsheet(file) {
  const name = String(file?.name ?? 'data');
  if (/\.xls$/i.test(name)) throw new Error('Old .xls files aren’t supported — save it as .xlsx or CSV and drop it again.');
  if (/\.xlsx$/i.test(name)) return toTable(name, parseXlsx(new Uint8Array(await file.arrayBuffer())));
  if (/\.(csv|tsv)$/i.test(name)) return toTable(name, parseCsv(await file.text()));
  throw new Error('Drop an Excel (.xlsx) or CSV file.');
}
