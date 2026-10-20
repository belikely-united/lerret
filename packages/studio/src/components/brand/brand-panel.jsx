// brand-panel.jsx — the Brand library, docked on the left of the canvas.
//
// Colours, fonts and logos shared by every page. Click an item to use it on
// the selected element (linked — editing the item later updates every design
// that uses it); drag a logo onto a design or empty canvas.
//
// Motion: the panel slides in from the left edge it lives on (spatial
// consistency, --lm-duration-base, translate + opacity); reduced motion keeps
// only the fade. Hover/press feedback is gated to fine pointers.

import React from 'react';
import { createPortal } from 'react-dom';

import { dcToast } from '../../design-canvas.jsx';
import { useWorkflowMode } from '../workflow/workflow-mode.js';
import { CURATED_FONTS } from '../../fonts/curated-fonts.js';
import {
  useBrand,
  setBrandOpen,
  addColor,
  updateColor,
  removeColor,
  addFont,
  updateFont,
  removeFont,
  addLogo,
  replaceLogo,
  removeLogo,
  logoUrl,
  uploadFontFile,
} from './brand-store.js';
import { applyBrandColor, applyBrandFont, placeBrandLogo, LOGO_DRAG_TYPE } from './brand-apply.js';
import './brand.css';

const report = (res, done) => {
  if (res && res.ok === false) dcToast(res.error || 'Couldn’t apply that.');
  else if (done) dcToast(done);
};

/**
 * @param {{ customFamilies?: string[] }} props
 *   Families from the project's `_fonts/` (offered alongside the curated list).
 */
export function BrandPanel({ customFamilies = [] }) {
  const { brand, loaded, open, error } = useBrand();
  const workflow = useWorkflowMode();
  if (!open || workflow || typeof document === 'undefined') return null;
  return createPortal(
    <aside className="lm-brand" data-edit-ui aria-label="Brand library" data-testid="lm-brand-panel">
      <header className="lm-brand__head">
        <div>
          <h2>Brand</h2>
          <p>Shared by every page</p>
        </div>
        <button type="button" className="lm-brand__icon" aria-label="Close brand library" onClick={() => setBrandOpen(false)}>×</button>
      </header>
      {error && <p className="lm-brand__error" role="alert">{error}</p>}
      {!loaded ? (
        <p className="lm-brand__hint">Loading…</p>
      ) : (
        <>
          <Colors colors={brand.colors} />
          <Fonts fonts={brand.fonts} customFamilies={customFamilies} />
          <Logos logos={brand.logos} />
          <p className="lm-brand__hint lm-brand__foot">
            Click an item to use it on what’s selected. Changing it here updates every design that uses it.
          </p>
        </>
      )}
    </aside>,
    document.body,
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
      {colors.length === 0 && editing !== 'new' && <p className="lm-brand__hint">Add your brand colours to use them on any page.</p>}
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
            <div key={c.id} className="lm-brand__color">
              <button
                type="button"
                className="lm-brand__color-main"
                onClick={() => applyBrandColor(c).then((r) => report(r))}
                title={`Use ${c.name} on the selection`}
                data-testid={`lm-brand-color-${c.id}`}
              >
                <span className="lm-brand__swatch" style={{ background: c.value }} />
                <span className="lm-brand__color-text">
                  <b>{c.name}</b>
                  <em>{c.value.toUpperCase()}</em>
                </span>
              </button>
              <button type="button" className="lm-brand__icon lm-brand__edit" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c.id)}>✎</button>
            </div>
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

function ColorForm({ initial, onSave, onCancel, onRemove }) {
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

function FormButtons({ onCancel, onRemove, disabled }) {
  return (
    <div className="lm-brand__form-actions">
      {onRemove && <button type="button" className="lm-brand__link lm-brand__link--danger" onClick={onRemove}>Remove</button>}
      <span style={{ flex: 1 }} />
      <button type="button" className="lm-brand__btn" onClick={onCancel}>Cancel</button>
      <button type="submit" className="lm-brand__btn lm-brand__btn--primary" disabled={disabled}>Save</button>
    </div>
  );
}

// ── Fonts ───────────────────────────────────────────────────────────────────

const familyOf = (css) => String(css).split(',')[0].replace(/['"]/g, '').trim();

function Fonts({ fonts, customFamilies }) {
  const [editing, setEditing] = React.useState(null);
  return (
    <section className="lm-brand__section" aria-label="Fonts">
      <div className="lm-brand__section-head">
        <h3>Fonts</h3>
        <button type="button" className="lm-brand__add" onClick={() => setEditing('new')} data-testid="lm-brand-add-font">+ Add</button>
      </div>
      {fonts.length === 0 && editing !== 'new' && <p className="lm-brand__hint">Name your heading and body fonts.</p>}
      {fonts.map((f) =>
        editing === f.id ? (
          <FontForm
            key={f.id}
            initial={f}
            customFamilies={customFamilies}
            onCancel={() => setEditing(null)}
            onSave={(v) => updateFont(f.id, v).then(() => setEditing(null))}
            onRemove={() => removeFont(f.id).then(() => setEditing(null))}
          />
        ) : (
          <div key={f.id} className="lm-brand__font">
            <button type="button" className="lm-brand__font-main" onClick={() => applyBrandFont(f).then((r) => report(r))} title={`Use ${f.name} on the selected text`} data-testid={`lm-brand-font-${f.id}`}>
              <span className="lm-brand__aa" style={{ fontFamily: `'${f.family}'` }}>Aa</span>
              <span className="lm-brand__color-text">
                <b>{f.name}</b>
                <em>{f.family}</em>
              </span>
            </button>
            <button type="button" className="lm-brand__icon lm-brand__edit" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f.id)}>✎</button>
          </div>
        ),
      )}
      {editing === 'new' && (
        <FontForm
          initial={{ name: '', family: 'Inter' }}
          customFamilies={customFamilies}
          onCancel={() => setEditing(null)}
          onSave={(v) => addFont(v).then(() => setEditing(null))}
        />
      )}
    </section>
  );
}

function FontForm({ initial, customFamilies, onSave, onCancel, onRemove }) {
  const [name, setName] = React.useState(initial.name);
  const [family, setFamily] = React.useState(initial.family);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef(null);
  const families = [...new Set([...CURATED_FONTS.slice(1).map(([, css]) => familyOf(css)), ...customFamilies, family])];
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    const fam = await uploadFontFile(file);
    setUploading(false);
    if (fam) setFamily(fam);
  };
  return (
    <form className="lm-brand__form" onSubmit={(e) => { e.preventDefault(); onSave({ name: name.trim() || family, family }); }} onKeyDown={(e) => e.stopPropagation()}>
      <input className="lm-brand__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Heading" aria-label="Font name" autoFocus />
      <select className="lm-brand__input" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Font" style={{ fontFamily: `'${family}'` }}>
        {families.map((f) => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
      </select>
      <button type="button" className="lm-brand__link" onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload a font file (.woff2, .ttf, .otf)…'}
      </button>
      <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={onFile} />
      <FormButtons onCancel={onCancel} onRemove={onRemove} />
    </form>
  );
}

// ── Logos ───────────────────────────────────────────────────────────────────

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
        <p className="lm-brand__hint">Drop your logo files here, or use + Add.</p>
      ) : (
        <div className="lm-brand__logos">
          {logos.map((l) => <LogoTile key={l.id} logo={l} />)}
        </div>
      )}
    </section>
  );
}

function LogoTile({ logo }) {
  const imgRef = React.useRef(null);
  const replaceRef = React.useRef(null);
  const natural = () => ({ width: imgRef.current?.naturalWidth || 512, height: imgRef.current?.naturalHeight || 512 });
  return (
    <div className="lm-brand__logo">
      <button
        type="button"
        className="lm-brand__logo-main"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData(LOGO_DRAG_TYPE, JSON.stringify({ ...logo, ...natural() }));
          if (imgRef.current) e.dataTransfer.setDragImage(imgRef.current, 24, 24);
        }}
        onClick={() => placeBrandLogo(logo, natural()).then((r) => report(r))}
        title={`${logo.name} — click to place on the selected design, or drag onto a design`}
        data-testid={`lm-brand-logo-${logo.id}`}
      >
        <img ref={imgRef} src={logoUrl(logo.file)} alt={logo.name} draggable={false} />
      </button>
      <span className="lm-brand__logo-name" title={logo.name}>{logo.name}</span>
      <span className="lm-brand__logo-actions">
        <button type="button" className="lm-brand__link" onClick={() => replaceRef.current?.click()}>Replace</button>
        <button type="button" className="lm-brand__link lm-brand__link--danger" onClick={() => removeLogo(logo.id)}>Remove</button>
      </span>
      <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) replaceLogo(logo.id, f).then(() => dcToast(`Replaced ${logo.name} everywhere it’s used`)); }} />
    </div>
  );
}

export default BrandPanel;
