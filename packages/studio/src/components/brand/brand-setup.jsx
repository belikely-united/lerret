// brand-setup.jsx — the brand setup wizard.
//
// Opens the first time a project without a brand library is opened (and from
// the Brand panel's "Set up"). Four steps, skippable at any point:
//   1. Your app   — name, tagline, and a link to Import from website
//   2. Colours    — any number, named, editable
//   3. Text styles — Display/Heading 1/Heading 2/Body/Caption + custom ones
//   4. Logos      — imported candidates and/or uploads, each with a type and
//                   an optional light version
// Nothing is written until "Save brand" (then brand.json + logo files + the
// root config vars), so backing out never leaves half a brand behind.
//
// Motion: the sheet uses the shared modal entrance (.lm-motion-modal); steps
// slide in the direction of travel (spatial consistency, --lm-duration-base);
// reduced motion fades only.

import React from 'react';
import { createPortal } from 'react-dom';
import { starterBrand, brandId, normalizeTextStyle, LOGO_KINDS, luminance } from '@lerret/core';

import { importBrandFromUrl } from '../../runtime/write-client.js';
import { ensureGoogleFont } from '../../fonts/curated-fonts.js';
import { useBrand, saveWholeBrand, markSetup, writeBrandFile, logoUrl } from './brand-store.js';
import { curatedFamilies, weightLabel } from './brand-page.jsx';
import './brand.css';

const STEPS = ['Your app', 'Colours', 'Text styles', 'Logos'];
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

/** Name imported colours by role so the palette reads well. */
function nameColors(values) {
  const vivid = ['Primary', 'Secondary', 'Accent', 'Highlight'];
  let v = 0;
  return values.map((value) => {
    const l = luminance(value) ?? 0.5;
    const name = l < 0.08 ? 'Ink' : l > 0.85 ? 'Paper' : vivid[v++] || `Colour ${v}`;
    return { value, name };
  });
}

const fileFromBase64 = (base64, mimeType, name) => {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const ext = { 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png', 'image/x-icon': 'ico' }[mimeType] || 'png';
  return new File([bytes], `${name}.${ext}`, { type: mimeType });
};

/**
 * @param {{ customFamilies?: string[] }} props
 */
export function BrandSetup({ customFamilies = [] }) {
  const { setupOpen, brand, loaded } = useBrand();
  if (!setupOpen || !loaded || typeof document === 'undefined') return null;
  return <Wizard initial={brand} customFamilies={customFamilies} />;
}

function Wizard({ initial, customFamilies }) {
  const [step, setStep] = React.useState(0);
  const [dir, setDir] = React.useState('fwd');
  const [draft, setDraft] = React.useState(() => {
    const base = initial.colors.length || initial.textStyles.length || initial.logos.length ? initial : { ...starterBrand(), app: initial.app || {} };
    return {
      app: { ...base.app },
      colors: base.colors.map((c) => ({ ...c })),
      textStyles: (base.textStyles.length ? base.textStyles : starterBrand().textStyles).map((t) => ({ ...t })),
      logos: base.logos.map((l) => ({ ...l, keep: true, existing: true })),
    };
  });
  const [url, setUrl] = React.useState(initial.app?.url || '');
  const [importing, setImporting] = React.useState(false);
  const [importMsg, setImportMsg] = React.useState(null);
  const [fonts, setFonts] = React.useState([]); // imported families
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        markSetup(initial.setup || 'skipped');
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [saving, initial.setup]);

  const go = (n) => {
    setDir(n > step ? 'fwd' : 'back');
    setStep(n);
  };
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  const runImport = async () => {
    setImporting(true);
    setImportMsg(null);
    const r = await importBrandFromUrl(url);
    setImporting(false);
    if (!r.ok) {
      setImportMsg({ error: true, text: r.error || 'Couldn’t read that page.' });
      return;
    }
    const found = [];
    // Build the next draft from the current one, THEN set it — the summary
    // below must describe what was actually added.
    const d = draft;
    const next = { ...d, app: { ...d.app, url: r.app?.url || url } };
    if (r.app?.name && !d.app.name) next.app.name = r.app.name;
    if (r.app?.tagline && !d.app.tagline) next.app.tagline = r.app.tagline;
    if (r.colors?.length) {
      const taken = d.colors.map((c) => c.id);
      const add = nameColors(r.colors).filter((c) => !d.colors.some((x) => x.value.toUpperCase() === c.value));
      next.colors = [...d.colors, ...add.map((c) => {
        const id = brandId(c.name, taken);
        taken.push(id);
        return { id, ...c };
      })];
      if (add.length) found.push(`${add.length} colour${add.length === 1 ? '' : 's'}`);
    }
    if (r.fonts?.length) {
      const [heading, body = heading] = r.fonts;
      next.textStyles = d.textStyles.map((t) => ({ ...t, family: /display|h1|h2|heading/i.test(`${t.id} ${t.name}`) ? heading : body }));
      found.push(`fonts (${r.fonts.slice(0, 2).join(', ')})`);
    }
    if (r.logos?.length) {
      next.logos = [
        ...d.logos.filter((l) => !String(l.id).startsWith('import-')),
        ...r.logos.map((l, i) => ({
          id: `import-${i}`,
          name: i === 0 ? next.app.name || 'Logo' : `${next.app.name || 'Logo'} ${i + 1}`,
          kind: /icon/i.test(l.source) ? 'icon' : 'full',
          keep: i === 0,
          pending: { base64: l.base64, mimeType: l.mimeType, source: l.source },
        })),
      ];
      found.push(`${r.logos.length} logo image${r.logos.length === 1 ? '' : 's'}`);
    }
    setDraft(next);
    r.fonts?.forEach(ensureGoogleFont);
    setFonts(r.fonts || []);
    const named = r.app?.name ? `${r.app.name}: ` : '';
    setImportMsg({ text: found.length ? `${named}found ${found.join(', ')}. Review them in the next steps.` : `${named}read the page, but found no colours, fonts or logos — add them by hand.` });
  };

  const save = async () => {
    setSaving(true);
    const logos = [];
    for (const l of draft.logos) {
      if (!l.keep) continue;
      if (l.existing) {
        const { keep: _k, existing: _e, ...rest } = l;
        logos.push(rest);
        continue;
      }
      const variants = [];
      const main = l.pending ? fileFromBase64(l.pending.base64, l.pending.mimeType, brandId(l.name)) : l.file;
      const saved = main && (await writeBrandFile(main, main.name));
      if (saved) variants.push({ id: 'colour', label: 'Colour', file: saved });
      if (l.lightFile) {
        const s2 = await writeBrandFile(l.lightFile, `${brandId(l.name)}-light.${(l.lightFile.name.split('.').pop() || 'png').toLowerCase()}`);
        if (s2) variants.push({ id: 'light', label: 'Light', file: s2 });
      }
      if (variants.length) logos.push({ id: brandId(l.name, logos.map((x) => x.id)), name: l.name, kind: l.kind, variants });
    }
    await saveWholeBrand({
      version: 2,
      setup: 'done',
      app: Object.fromEntries(Object.entries(draft.app).filter(([, v]) => typeof v === 'string' && v.trim())),
      colors: draft.colors.filter((c) => /^#[0-9a-f]{3,6}$/i.test(c.value)),
      textStyles: draft.textStyles.map(normalizeTextStyle),
      logos,
    });
    setSaving(false);
    markSetup('done');
  };

  const families = [...new Set([...fonts, ...curatedFamilies(), ...customFamilies, ...draft.textStyles.map((t) => t.family)])];

  return createPortal(
    <div className="lm-setup-overlay">
      <div className="lm-setup lm-motion-modal" role="dialog" aria-modal="true" aria-label="Set up your brand" data-testid="lm-brand-setup">
        <header className="lm-setup__head">
          <div>
            <h2>Set up your brand</h2>
            <p>Saved in the project and used on every page — set it once.</p>
          </div>
          <ol className="lm-setup__steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button type="button" aria-current={i === step ? 'step' : undefined} data-done={i < step || undefined} onClick={() => go(i)}>
                  <span>{i + 1}</span>{s}
                </button>
              </li>
            ))}
          </ol>
        </header>

        <div key={step} className="lm-setup__body lm-setup-step" data-dir={dir}>
          {step === 0 && (
            <>
              <label className="lm-setup__field">
                <span>Website or store link</span>
                <div className="lm-setup__import">
                  <input
                    className="lm-brand__input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); runImport(); } }}
                    placeholder="https://yourapp.com or an App Store / Microsoft Store link"
                    data-testid="lm-setup-url"
                  />
                  <button type="button" className="lm-brand__btn lm-brand__btn--primary" onClick={runImport} disabled={importing || !url.trim()} data-testid="lm-setup-import">
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
                {importMsg && <em className={importMsg.error ? 'lm-setup__msg lm-setup__msg--error' : 'lm-setup__msg'} role="status">{importMsg.text}</em>}
                <em className="lm-setup__hint">Lerret reads the page and suggests colours, fonts and logos. You review everything before it’s saved.</em>
              </label>
              <label className="lm-setup__field">
                <span>App or brand name</span>
                <input className="lm-brand__input" value={draft.app.name || ''} onChange={(e) => patch({ app: { ...draft.app, name: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} placeholder="e.g. Acme" data-testid="lm-setup-name" />
              </label>
              <label className="lm-setup__field">
                <span>Tagline</span>
                <input className="lm-brand__input" value={draft.app.tagline || ''} onChange={(e) => patch({ app: { ...draft.app, tagline: e.target.value } })} onKeyDown={(e) => e.stopPropagation()} placeholder="One line about what it does" />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              {draft.colors.length === 0 && <p className="lm-brand__hint">Add as many colours as your brand uses — primary, accents, neutrals.</p>}
              <div className="lm-setup__colors">
                {draft.colors.map((c, i) => (
                  <div key={c.id} className="lm-setup__color">
                    <label className="lm-brand__swatch lm-brand__swatch--pick" style={{ background: c.value }}>
                      <input type="color" value={c.value.length === 7 ? c.value : '#000000'} onChange={(e) => patch({ colors: draft.colors.map((x, j) => (j === i ? { ...x, value: e.target.value.toUpperCase() } : x)) })} aria-label={`${c.name} colour`} />
                    </label>
                    <input className="lm-brand__input" value={c.name} onChange={(e) => patch({ colors: draft.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} aria-label="Colour name" />
                    <input className="lm-brand__input lm-setup__hex" value={c.value} onChange={(e) => patch({ colors: draft.colors.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} onKeyDown={(e) => e.stopPropagation()} aria-label="Hex" />
                    <button type="button" className="lm-brand__icon" aria-label={`Remove ${c.name}`} onClick={() => patch({ colors: draft.colors.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="lm-brand__btn"
                onClick={() => patch({ colors: [...draft.colors, { id: brandId(`Colour ${draft.colors.length + 1}`, draft.colors.map((c) => c.id)), name: `Colour ${draft.colors.length + 1}`, value: '#2F5BFF' }] })}
                data-testid="lm-setup-add-color"
              >
                + Add colour
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="lm-setup__styles">
                {draft.textStyles.map((t, i) => {
                  const up = (p) => patch({ textStyles: draft.textStyles.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <div key={t.id} className="lm-setup__style">
                      <input className="lm-brand__input lm-setup__style-name" value={t.name} onChange={(e) => up({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="Style name" style={{ fontFamily: `'${t.family}'`, fontWeight: t.weight }} />
                      <select className="lm-brand__input" value={t.family} onChange={(e) => { ensureGoogleFont(e.target.value); up({ family: e.target.value }); }} aria-label={`${t.name} font`}>
                        {families.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <input className="lm-brand__input lm-setup__num" type="number" min="6" max="600" value={t.size} onChange={(e) => up({ size: Number(e.target.value) })} aria-label={`${t.name} size`} title="Size (px on a 1080px-wide design)" />
                      <select className="lm-brand__input lm-setup__num" value={t.weight} onChange={(e) => up({ weight: Number(e.target.value) })} aria-label={`${t.name} weight`}>
                        {WEIGHTS.map((w) => <option key={w} value={w}>{weightLabel(w)}</option>)}
                      </select>
                      <button type="button" className="lm-brand__icon" aria-label={`Remove ${t.name}`} onClick={() => patch({ textStyles: draft.textStyles.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="lm-brand__btn"
                onClick={() => patch({ textStyles: [...draft.textStyles, { id: brandId('Custom style', draft.textStyles.map((t) => t.id)), name: 'Custom style', family: draft.textStyles[0]?.family || 'Inter', size: 48, weight: 600, lineHeight: 1.2, letterSpacing: '0em' }] })}
                data-testid="lm-setup-add-style"
              >
                + Add a custom style
              </button>
              <p className="lm-brand__hint">Sizes are for a 1080px-wide design; templates scale them to fit each format.</p>
            </>
          )}

          {step === 3 && <LogosStep draft={draft} patch={patch} />}
        </div>

        <footer className="lm-setup__foot">
          <button type="button" className="lm-brand__link" onClick={() => markSetup(initial.setup || 'skipped')} disabled={saving} data-testid="lm-setup-skip">
            {initial.setup ? 'Cancel' : 'Skip for now'}
          </button>
          <span style={{ flex: 1 }} />
          {step > 0 && <button type="button" className="lm-brand__btn" onClick={() => go(step - 1)} disabled={saving}>Back</button>}
          {step < STEPS.length - 1 ? (
            <button type="button" className="lm-brand__btn lm-brand__btn--primary" onClick={() => go(step + 1)} data-testid="lm-setup-next">Next</button>
          ) : (
            <button type="button" className="lm-brand__btn lm-brand__btn--primary" onClick={save} disabled={saving} data-testid="lm-setup-save">
              {saving ? 'Saving…' : 'Save brand'}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function LogosStep({ draft, patch }) {
  const addRef = React.useRef(null);
  const set = (i, p) => patch({ logos: draft.logos.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const preview = (l) => (l.existing ? logoUrl(l.variants[0].file) : l.pending ? `data:${l.pending.mimeType};base64,${l.pending.base64}` : l.previewUrl);
  return (
    <>
      {draft.logos.length === 0 && <p className="lm-brand__hint">Upload your logo — and an icon or wordmark if you have them.</p>}
      <div className="lm-setup__logos">
        {draft.logos.map((l, i) => (
          <div key={l.id} className={`lm-setup__logo${l.keep ? '' : ' lm-setup__logo--off'}`}>
            <label className="lm-setup__logo-pick">
              <input type="checkbox" checked={!!l.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Keep ${l.name}`} />
              <span className="lm-brand__logo-main"><img src={preview(l)} alt="" /></span>
            </label>
            <input className="lm-brand__input" value={l.name} onChange={(e) => set(i, { name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="Logo name" />
            <select className="lm-brand__input" value={l.kind} onChange={(e) => set(i, { kind: e.target.value })} aria-label="Logo type">
              {LOGO_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            {l.pending?.source && <em className="lm-setup__hint">{l.pending.source}</em>}
            {!l.existing && (
              <label className="lm-brand__link">
                {l.lightFile ? `Light version: ${l.lightFile.name}` : '+ Light version (for dark backgrounds)'}
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set(i, { lightFile: f }); }} />
              </label>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="lm-brand__btn" onClick={() => addRef.current?.click()} data-testid="lm-setup-add-logo">+ Upload logos</button>
      <input
        ref={addRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          patch({
            logos: [
              ...draft.logos,
              ...files.map((f, k) => ({ id: `upload-${Date.now()}-${k}`, name: f.name.replace(/\.[^.]+$/, ''), kind: 'full', keep: true, file: f, previewUrl: URL.createObjectURL(f) })),
            ],
          });
        }}
      />
    </>
  );
}

export default BrandSetup;
