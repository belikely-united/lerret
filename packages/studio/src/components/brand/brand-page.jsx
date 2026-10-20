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
import { createPortal } from 'react-dom';
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

// ── Edit popover ────────────────────────────────────────────────────────────

/**
 * A popover anchored to the item being edited (found by its
 * `data-brand-item` key, so it survives re-renders). Below the item, or above
 * when there's no room; grows from the item. Esc / outside click closes it.
 */
function EditPopover({ itemKey, label, onClose, children }) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  const anchor = () => document.querySelector(`[data-brand-item="${itemKey}"]`);
  const place = React.useCallback(() => {
    const a = document.querySelector(`[data-brand-item="${itemKey}"]`);
    const el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.bottom + 8 + h <= window.innerHeight - 12;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
    const top = below ? r.bottom + 8 : Math.max(12, r.top - 8 - h);
    setPos({ left, top, origin: `${Math.round(r.left + r.width / 2 - left)}px ${below ? '0' : '100%'}` });
  }, [itemKey]);
  React.useLayoutEffect(() => {
    place();
    ref.current?.querySelector('input, select, button')?.focus();
  }, [place]);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor()?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, place]);
  return createPortal(
    <div
      ref={ref}
      className="lm-brand-pop"
      role="dialog"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : { visibility: 'hidden' }}
      onKeyDown={(e) => e.stopPropagation()}
      data-testid="lm-brand-pop"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Edits apply as you make them (debounced, so dragging the colour picker
 * doesn't write on every frame); whatever is pending is saved on close.
 */
function useLiveSave(value, save, delay = 250) {
  const pending = React.useRef(null);
  const latest = React.useRef(save);
  React.useLayoutEffect(() => {
    latest.current = save;
  });
  React.useEffect(() => {
    if (value === null) return undefined;
    pending.current = value;
    const t = setTimeout(() => {
      latest.current(pending.current);
      pending.current = null;
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  // Flush on unmount (closing the popover).
  React.useEffect(() => () => {
    if (pending.current !== null) latest.current(pending.current);
  }, []);
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

function ColorPopover({ color, onClose }) {
  const [name, setName] = React.useState(color.name);
  const [value, setValue] = React.useState(color.value);
  const [dirty, setDirty] = React.useState(null);
  const edit = (patch) => {
    if (patch.name !== undefined) setName(patch.name);
    if (patch.value !== undefined) setValue(patch.value);
    setDirty({ name: patch.name ?? name, value: patch.value ?? value });
  };
  useLiveSave(dirty, (d) => {
    const v = d.value.trim();
    if (!HEX.test(v)) return;
    updateColor(color.id, { name: d.name.trim() || 'Colour', value: v.toUpperCase() });
  });
  const valid = HEX.test(value.trim());
  return (
    <EditPopover itemKey={`color-${color.id}`} label={`Edit ${color.name}`} onClose={onClose}>
      <label className="lm-brand-pop__swatch" style={{ background: valid ? value : '#FFFFFF' }} title="Pick a colour">
        <input type="color" value={valid && value.length === 7 ? value : '#000000'} onChange={(e) => edit({ value: e.target.value.toUpperCase() })} aria-label="Pick a colour" />
        <span>Click to pick a colour</span>
      </label>
      <div className="lm-brand-pop__row">
        <label className="lm-brand__mini"><span>Hex</span>
          <input className="lm-brand__input lm-brand-pop__hex" value={value} onChange={(e) => edit({ value: e.target.value })} aria-label="Hex value" spellCheck={false} aria-invalid={!valid} />
        </label>
        <label className="lm-brand__mini" style={{ flex: 1 }}><span>Name</span>
          <input className="lm-brand__input" value={name} onChange={(e) => edit({ name: e.target.value })} aria-label="Colour name" placeholder="e.g. Primary" />
        </label>
      </div>
      <p className="lm-brand__hint">Changes apply to every design that uses this colour.</p>
      <div className="lm-brand-pop__foot">
        <button type="button" className="lm-brand__link lm-brand__link--danger" onClick={() => removeColor(color.id).then(onClose)} data-testid="lm-brand-pop-delete">Delete colour</button>
        <button type="button" className="lm-brand__btn lm-brand__btn--primary" onClick={onClose}>Done</button>
      </div>
    </EditPopover>
  );
}

// ── Colours ─────────────────────────────────────────────────────────────────

function Colors({ colors }) {
  const [editing, setEditing] = React.useState(null); // colour id
  const add = () => addColor({ name: 'New colour', value: '#2F5BFF' }).then((c) => setEditing(c.id));
  const current = colors.find((c) => c.id === editing);
  return (
    <section className="lm-brand__section" aria-label="Colours">
      <div className="lm-brand__section-head">
        <h3>Colours</h3>
        <button type="button" className="lm-brand__add" onClick={add} data-testid="lm-brand-add-color">+ Add</button>
      </div>
      {colors.length === 0 && <p className="lm-brand__hint">Add your brand colours — they show up first in every colour picker.</p>}
      <div className="lm-brand__colors">
        {colors.map((c) => (
          <button
            key={c.id}
            type="button"
            className="lm-brand__color"
            aria-expanded={editing === c.id}
            onClick={() => setEditing(editing === c.id ? null : c.id)}
            title={`Edit ${c.name}`}
            data-brand-item={`color-${c.id}`}
            data-testid={`lm-brand-color-${c.id}`}
          >
            <span className="lm-brand__swatch" style={{ background: c.value }} />
            <span className="lm-brand__color-text">
              <b>{c.name}</b>
              <em>{c.value.toUpperCase()}</em>
            </span>
          </button>
        ))}
      </div>
      {current && <ColorPopover key={current.id} color={current} onClose={() => setEditing(null)} />}
    </section>
  );
}

// ── Text styles ─────────────────────────────────────────────────────────────

function TextStylePopover({ style, customFamilies, onClose }) {
  const [v, setV] = React.useState(() => normalizeTextStyle(style));
  const [dirty, setDirty] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef(null);
  const families = [...new Set([...curatedFamilies(), ...customFamilies, v.family])];
  const upd = (patch) => {
    const next = { ...v, ...patch };
    setV(next);
    setDirty(next);
  };
  useLiveSave(dirty, (d) => {
    const { id: _id, ...rest } = d;
    // A half-typed size (empty, 0) keeps the last good one.
    updateTextStyle(style.id, { ...rest, size: d.size >= 6 ? d.size : style.size, name: d.name.trim() || 'Style' });
  });
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
    <EditPopover itemKey={`style-${style.id}`} label={`Edit ${style.name}`} onClose={onClose}>
      <p className="lm-brand-pop__preview" style={{ fontFamily: `'${v.family}'`, fontWeight: v.weight, letterSpacing: v.letterSpacing, lineHeight: v.lineHeight }}>
        The quick brown fox
      </p>
      <label className="lm-brand__mini"><span>Name</span>
        <input className="lm-brand__input" value={v.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Style name" placeholder="e.g. Heading 1" />
      </label>
      <label className="lm-brand__mini"><span>Font</span>
        <select className="lm-brand__input" value={v.family} onChange={(e) => upd({ family: e.target.value })} aria-label="Font" style={{ fontFamily: `'${v.family}'` }}>
          {families.map((f) => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
        </select>
      </label>
      <div className="lm-brand__grid2">
        <label className="lm-brand__mini"><span>Size</span><input className="lm-brand__input" type="number" min="6" max="600" value={v.size} onChange={(e) => upd({ size: Number(e.target.value) })} aria-label="Size" /></label>
        <label className="lm-brand__mini"><span>Weight</span>
          <select className="lm-brand__input" value={v.weight} onChange={(e) => upd({ weight: Number(e.target.value) })} aria-label="Weight">
            {WEIGHTS.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
          </select>
        </label>
        <label className="lm-brand__mini"><span>Line height</span><input className="lm-brand__input" type="number" step="0.05" min="0.5" max="3" value={v.lineHeight} onChange={(e) => upd({ lineHeight: Number(e.target.value) })} aria-label="Line height" /></label>
        <label className="lm-brand__mini"><span>Spacing</span><input className="lm-brand__input" value={v.letterSpacing} onChange={(e) => upd({ letterSpacing: e.target.value })} aria-label="Letter spacing" placeholder="0em" /></label>
      </div>
      <button type="button" className="lm-brand__link" onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload a font file (.woff2, .ttf, .otf)…'}
      </button>
      <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={onFile} />
      <div className="lm-brand-pop__foot">
        <button type="button" className="lm-brand__link lm-brand__link--danger" onClick={() => removeTextStyle(style.id).then(onClose)} data-testid="lm-brand-pop-delete">Delete style</button>
        <button type="button" className="lm-brand__btn lm-brand__btn--primary" onClick={onClose}>Done</button>
      </div>
    </EditPopover>
  );
}

function TextStyles({ styles, customFamilies }) {
  const [editing, setEditing] = React.useState(null); // style id
  const add = () =>
    addTextStyle({ name: 'New style', family: 'Inter', size: 48, weight: 600, lineHeight: 1.2, letterSpacing: '0em' }).then((t) => setEditing(t.id));
  const current = styles.find((t) => t.id === editing);
  return (
    <section className="lm-brand__section" aria-label="Text styles">
      <div className="lm-brand__section-head">
        <h3>Text styles</h3>
        <button type="button" className="lm-brand__add" onClick={add} data-testid="lm-brand-add-style">+ Add</button>
      </div>
      {styles.length === 0 && <p className="lm-brand__hint">Define headings, body and captions once; use them everywhere.</p>}
      {styles.map((st) => (
        <button
          key={st.id}
          type="button"
          className="lm-brand__font"
          aria-expanded={editing === st.id}
          onClick={() => setEditing(editing === st.id ? null : st.id)}
          title={`Edit ${st.name}`}
          data-brand-item={`style-${st.id}`}
          data-testid={`lm-brand-style-${st.id}`}
        >
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
      ))}
      {current && <TextStylePopover key={current.id} style={current} customFamilies={customFamilies} onClose={() => setEditing(null)} />}
    </section>
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
