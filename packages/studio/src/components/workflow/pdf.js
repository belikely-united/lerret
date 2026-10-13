// pdf.js — a minimal PDF writer: one JPEG per page, nothing else.
//
// Enough for "all 30 certificates in one PDF" without a PDF library: each page
// is sized to the design (CSS px → points at 72/96) and draws one DCTDecode
// image XObject covering it.

/**
 * @param {Array<{ jpeg: Uint8Array, imageWidth: number, imageHeight: number, width: number, height: number }>} pages
 *   `imageWidth/Height` — the JPEG's pixel size; `width/height` — the design's
 *   CSS px size (the page size).
 * @returns {Uint8Array}
 */
export function buildJpegPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const b of [].concat(body)) push(b);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const pageId = pageIds[i];
    const w = +(p.width * 0.75).toFixed(2);
    const h = +(p.height * 0.75).toFixed(2);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    obj(pageId + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    obj(pageId + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.imageWidth} /Height ${p.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n += 1) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
