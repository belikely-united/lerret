// brand-page.jsx — the built-in Brand page, pinned first in the page list.
//
// The project's brand library — colours, text styles and logo sets — laid out
// as a page you configure at any time. Everything is saved to
// `.lerret/_brand/brand.json` and used LINKED by every design (the Design
// panel's pickers, templates, the + Add menu), so a change here updates every
// page. "Set up" reopens the setup wizard (import from a website).
//
// Motion: sections fade up once on mount (spatial consistency for a page
// switch, --lm-duration-base); reduced motion keeps only the fade.

import React from 'react';
import { LOGO_KINDS, normalizeTextStyle } from '@lerret/core';

import { dcToast } from '../../design-canvas.jsx';
import { CURATED_FONTS } from '../../fonts/curated-fonts.js';
import {
  useBrand,
  setBrandSetupOpen,
  addColor,
  updateColor,
  removeColor,
  addTextStyle,
  updateTextStyle,
  removeTextStyle,
  addLogo,
  addLogoVariant,
  replaceLogoVariant,
  removeLogoVariant,
  removeLogo,
  updateLogo,
  logoUrl,
  uploadFontFile,
} from './brand-store.js';
import './brand.css';

/** The hash route of the Brand page (not a folder — the page is built in). */
export const BRAND_ROUTE = 'brand-library';

const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
export const weightLabel = (w) => WEIGHTS.find(([v]) => v === Number(w))?.[1] || String(w);
const familyOf = (css) => String(css).split(',')[0].replace(/['"]/g, '').trim();
export const curatedFamilies = () => CURATED_FONTS.slice(1).map(([, css]) => familyOf(css));

/**
 * @param {{ customFamilies?: string[] }} props
 *   Families from the project's `_fonts/` (offered alongside the curated list).
 */
export function BrandPage({ customFamilies = [] }) {
  const { brand, loaded, error } = useBrand();
  return (
    <main className="lm-brand-page" aria-label="Brand" data-testid="lm-brand-page">
      <header className="lm-brand-page__head">
        <div>
          <h1>{brand.app?.name ? `${brand.app.name} brand` : 'Brand'}</h1>
          <p>Colours, text styles and logos for every page. Change anything here and every design that uses it updates.</p>
        </div>
        <button type="button" className="lm-brand__btn" onClick={() => setBrandSetupOpen(true)} title="Import from a website, or edit everything step by step" data-testid="lm-brand-setup">
          Set up / import…
        </button>
      </header>
      {error && <p className="lm-brand__error" role="alert">{error}</p>}
      {!loaded ? (
        <p className="lm-brand__hint">Loading…</p>
      ) : (
        <>
          <Colors colors={brand.colors} />
          <TextStyles styles={brand.textStyles} customFamilies={customFamilies} />
          <Logos logos={brand.logos} />
        </>
      )}
    </main>
  );
}

// ── Colours ─────────────────────────────────────────────────────────────────

function Colors({ colors }) {
  const [editing, setEditing] = React.useState(null); // id | 'new' | null
  return (
    <section className="lm-brand__section" aria-label="Colours">
      <div className="lm-brand__section-head">
        <h3>Colours</h3>
        <button type="button" className="lm-brand__add" onClick={() => setEditing('new')} data-testid="lm-brand-add-color">+ Add</button>
      </div>
      {colors.length === 0 && editing !== 'new' && <p className="lm-brand__hint">Add your brand colours — they show up first in every colour picker.</p>}
      <div className="lm-brand__colors">
        {colors.map((c) =>
          editing === c.id ? (
            <ColorForm
              key={c.id}
              initial={c}
              onCancel={() => setEditing(null)}
              onSave={(v) => updateColor(c.id, v).then(() => setEditing(null))}
              onRemove={() => removeColor(c.id).then(() => setEditing(null))}
            />
          ) : (
            <button
              key={c.id}
              type="button"
              className="lm-brand__color"
              onClick={() => setEditing(c.id)}
              title={`Edit ${c.name}`}
              data-testid={`lm-brand-color-${c.id}`}
            >
              <span className="lm-brand__swatch" style={{ background: c.value }} />
              <span className="lm-brand__color-text">
                <b>{c.name}</b>
                <em>{c.value.toUpperCase()}</em>
              </span>
            </button>
          ),
        )}
        {editing === 'new' && (
          <ColorForm
            initial={{ name: '', value: '#2F5BFF' }}
            onCancel={() => setEditing(null)}
            onSave={(v) => addColor(v).then(() => setEditing(null))}
          />
        )}
      </div>
    </section>
  );
}

export function ColorForm({ initial, onSave, onCancel, onRemove }) {
  const [name, setName] = React.useState(initial.name);
  const [value, setValue] = React.useState(initial.value);
  const valid = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim());
  const submit = (e) => {
    e.preventDefault();
    if (valid) onSave({ name: name.trim() || 'Colour', value: value.trim() });
  };
  return (
    <form className="lm-brand__form" onSubmit={submit} onKeyDown={(e) => e.stopPropagation()}>
      <div className="lm-brand__row">
        <label className="lm-brand__swatch lm-brand__swatch--pick" style={{ background: valid ? value : '#fff' }} title="Pick a colour">
          <input type="color" value={valid && value.length === 7 ? value : '#000000'} onChange={(e) => setValue(e.target.value.toUpperCase())} aria-label="Colour" />
        </label>
        <input className="lm-brand__input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Hex value" spellCheck={false} style={{ width: 92, fontFamily: 'var(--lm-font-mono, monospace)' }} />
      </div>
      <input className="lm-brand__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Primary" aria-label="Colour name" autoFocus />
      <FormButtons onCancel={onCancel} onRemove={onRemove} disabled={!valid} />
    </form>
  );
}

export function FormButtons({ onCancel, onRemove, disabled }) {
  return (
    <div className="lm-brand__form-actions">
      {onRemove && <button type="button" className="lm-brand__link lm-brand__link--danger" onClick={onRemove}>Remove</button>}
      <span style={{ flex: 1 }} />
      <button type="button" className="lm-brand__btn" onClick={onCancel}>Cancel</button>
      <button type="submit" className="lm-brand__btn lm-brand__btn--primary" disabled={disabled}>Save</button>
    </div>
  );
}

// ── Text styles ─────────────────────────────────────────────────────────────

function TextStyles({ styles, customFamilies }) {
  const [editing, setEditing] = React.useState(null);
  return (
    <section className="lm-brand__section" aria-label="Text styles">
      <div className="lm-brand__section-head">
        <h3>Text styles</h3>
        <button type="button" className="lm-brand__add" onClick={() => setEditing('new')} data-testid="lm-brand-add-style">+ Add</button>
      </div>
      {styles.length === 0 && editing !== 'new' && <p className="lm-brand__hint">Define headings, body and captions once; use them everywhere.</p>}
      {styles.map((st) =>
        editing === st.id ? (
          <TextStyleForm
            key={st.id}
            initial={st}
            customFamilies={customFamilies}
            onCancel={() => setEditing(null)}
            onSave={(v) => updateTextStyle(st.id, v).then(() => setEditing(null))}
            onRemove={() => removeTextStyle(st.id).then(() => setEditing(null))}
          />
        ) : (
          <button key={st.id} type="button" className="lm-brand__font" onClick={() => setEditing(st.id)} title={`Edit ${st.name}`} data-testid={`lm-brand-style-${st.id}`}>
            <span className="lm-brand__font-meta">
              <b>{st.name}</b>
              <em>{st.family} · {st.size}px · {weightLabel(st.weight)} · {st.lineHeight}</em>
            </span>
            <span
              className="lm-brand__specimen"
              style={{ fontFamily: `'${st.family}'`, fontWeight: st.weight, fontSize: Math.max(14, Math.min(56, st.size / 2)), letterSpacing: st.letterSpacing, lineHeight: st.lineHeight }}
            >
              The quick brown fox
            </span>
          </button>
        ),
      )}
      {editing === 'new' && (
        <TextStyleForm
          initial={{ name: '', family: 'Inter', size: 48, weight: 600, lineHeight: 1.2, letterSpacing: '0em' }}
          customFamilies={customFamilies}
          onCancel={() => setEditing(null)}
          onSave={(v) => addTextStyle(v).then(() => setEditing(null))}
        />
      )}
    </section>
  );
}

export function TextStyleForm({ initial, customFamilies, onSave, onCancel, onRemove }) {
  const [v, setV] = React.useState(() => normalizeTextStyle({ id: 'x', ...initial }));
  const [name, setName] = React.useState(initial.name || '');
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef(null);
  const families = [...new Set([...curatedFamilies(), ...customFamilies, v.family])];
  const upd = (patch) => setV((cur) => ({ ...cur, ...patch }));
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    const fam = await uploadFontFile(file);
    setUploading(false);
    if (fam) upd({ family: fam });
  };
  return (
    <form
      className="lm-brand__form"
      onSubmit={(e) => {
        e.preventDefault();
        const { id: _id, ...rest } = v;
        onSave({ ...rest, name: name.trim() || 'Style' });
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input className="lm-brand__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Heading 1" aria-label="Style name" autoFocus />
      <select className="lm-brand__input" value={v.family} onChange={(e) => upd({ family: e.target.value })} aria-label="Font" style={{ fontFamily: `'${v.family}'` }}>
        {families.map((f) => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
      </select>
      <div className="lm-brand__grid2">
        <label className="lm-brand__mini"><span>Size</span><input className="lm-brand__input" type="number" min="6" max="600" value={v.size} onChange={(e) => upd({ size: Number(e.target.value) })} aria-label="Size" /></label>
        <label className="lm-brand__mini"><span>Weight</span>
          <select className="lm-brand__input" value={v.weight} onChange={(e) => upd({ weight: Number(e.target.value) })} aria-label="Weight">
            {WEIGHTS.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
          </select>
        </label>
        <label className="lm-brand__mini"><span>Line</span><input className="lm-brand__input" type="number" step="0.05" min="0.5" max="3" value={v.lineHeight} onChange={(e) => upd({ lineHeight: Number(e.target.value) })} aria-label="Line height" /></label>
        <label className="lm-brand__mini"><span>Spacing</span><input className="lm-brand__input" value={v.letterSpacing} onChange={(e) => upd({ letterSpacing: e.target.value })} aria-label="Letter spacing" placeholder="0em" /></label>
      </div>
      <p className="lm-brand__preview" style={{ fontFamily: `'${v.family}'`, fontWeight: v.weight, letterSpacing: v.letterSpacing, lineHeight: v.lineHeight }}>The quick brown fox</p>
      <button type="button" className="lm-brand__link" onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload a font file (.woff2, .ttf, .otf)…'}
      </button>
      <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={onFile} />
      <FormButtons onCancel={onCancel} onRemove={onRemove} />
    </form>
  );
}

// ── Logos ───────────────────────────────────────────────────────────────────

const VARIANT_LABELS = ['Colour', 'Light', 'Dark', 'White', 'Black', 'Mono'];

function Logos({ logos }) {
  const addRef = React.useRef(null);
  const [over, setOver] = React.useState(false);
  const addFiles = async (files) => {
    const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|svg|webp|gif|avif)$/i.test(f.name));
    for (const f of images) await addLogo(f);
    if (images.length) dcToast(`Added ${images.length === 1 ? images[0].name : `${images.length} logos`} to the brand library`);
  };
  return (
    <section
      className={`lm-brand__section${over ? ' lm-brand__section--drop' : ''}`}
      aria-label="Logos"
      onDragOver={(e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        addFiles(e.dataTransfer.files || []);
      }}
      data-lm-brand-drop
    >
      <div className="lm-brand__section-head">
        <h3>Logos</h3>
        <button type="button" className="lm-brand__add" onClick={() => addRef.current?.click()} data-testid="lm-brand-add-logo">+ Add</button>
        <input ref={addRef} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; addFiles(f); }} />
      </div>
      {logos.length === 0 ? (
        <p className="lm-brand__hint">Drop your logo files here, or use + Add. Add light/dark versions to each — designs pick the one that suits their background.</p>
      ) : (
        <div className="lm-brand__logos">{logos.map((l) => <LogoSet key={l.id} logo={l} />)}</div>
      )}
    </section>
  );
}

function LogoSet({ logo }) {
  const [active, setActive] = React.useState(logo.variants[0].id);
  const variant = logo.variants.find((v) => v.id === active) || logo.variants[0];
  const replaceRef = React.useRef(null);
  const addRef = React.useRef(null);
  const [addLabel, setAddLabel] = React.useState(null);
  const dark = /light|white/i.test(variant.label);
  return (
    <div className="lm-brand__logo-set">
      <div className="lm-brand__logo-top">
        <input
          className="lm-brand__logo-title"
          defaultValue={logo.name}
          aria-label="Logo name"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
          onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== logo.name) updateLogo(logo.id, { name: n }); }}
        />
        <select className="lm-brand__kind" value={logo.kind} onChange={(e) => updateLogo(logo.id, { kind: e.target.value })} aria-label="Logo type">
          {LOGO_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>
      <div className={`lm-brand__logo-main${dark ? ' lm-brand__logo-main--dark' : ''}`} data-testid={`lm-brand-logo-${logo.id}`}>
        <img src={logoUrl(variant.file)} alt={`${logo.name} ${variant.label}`} draggable={false} />
      </div>
      <div className="lm-brand__variants" role="radiogroup" aria-label="Versions">
        {logo.variants.map((v) => (
          <button key={v.id} type="button" role="radio" aria-checked={v.id === variant.id} className="lm-brand__chip" onClick={() => setActive(v.id)}>{v.label}</button>
        ))}
        {addLabel === null ? (
          <button type="button" className="lm-brand__chip lm-brand__chip--add" onClick={() => setAddLabel(VARIANT_LABELS.find((l) => !logo.variants.some((v) => v.label === l)) || 'Version')}>+ Version</button>
        ) : (
          <span className="lm-brand__chip-add">
            <select value={addLabel} onChange={(e) => setAddLabel(e.target.value)} aria-label="Version name">
              {[...new Set([...VARIANT_LABELS, addLabel])].map((l) => <option key={l}>{l}</option>)}
            </select>
            <button type="button" className="lm-brand__link" onClick={() => addRef.current?.click()}>Choose file…</button>
            <button type="button" className="lm-brand__link" onClick={() => setAddLabel(null)}>Cancel</button>
          </span>
        )}
      </div>
      <span className="lm-brand__logo-actions">
        <button type="button" className="lm-brand__link" onClick={() => replaceRef.current?.click()}>Replace {variant.label.toLowerCase()}</button>
        <button
          type="button"
          className="lm-brand__link lm-brand__link--danger"
          onClick={() => (logo.variants.length > 1 ? removeLogoVariant(logo.id, variant.id) : removeLogo(logo.id))}
        >
          {logo.variants.length > 1 ? `Remove ${variant.label.toLowerCase()}` : 'Remove logo'}
        </button>
      </span>
      <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) replaceLogoVariant(logo.id, variant.id, f).then(() => dcToast(`Replaced ${logo.name} (${variant.label}) everywhere it’s used`)); }} />
      <input
        ref={addRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && addLabel) addLogoVariant(logo.id, f, addLabel).then((v) => { setAddLabel(null); if (v) setActive(v.id); });
        }}
      />
    </div>
  );
}

export default BrandPage;
