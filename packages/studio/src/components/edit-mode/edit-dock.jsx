// Visual Edit mode — the controls, living in the dock (spec-visual-edit-mode.md).
//
// Edit mode turns the dock into the edit toolbar, so there is one place to look:
//   • nothing selected → a one-line hint
//   • an element selected → only the few controls it most likely needs
//       text → Size · Weight · Color · Align      box → Fill · Radius · Padding
//   • "More" → everything else (text content, layout, position, props) in one
//     popover above the dock
// Style edits preview on the DOM instantly and save after a short pause; the
// canvas side (outlines, click, drag, double-click) is edit-mode-layer.jsx.

import React from 'react';
import { createPortal } from 'react-dom';

import '../forms/form-controls.css';
import './edit-mode.css';
import {
  useEditMode,
  toggleEditMode,
  setEditEnabled,
  selectElement,
  canSave,
  readAssetData,
  dataValueFor,
  saveSourceEdit,
  saveDataEdit,
  undo,
  redo,
} from './edit-session.js';
import {
  SAVE_DELAY_MS,
  WEIGHTS,
  GROUPED,
  EDITABLE_ATTRS,
  nodesFor,
  selectedNodes,
  slotOf,
  cssValue,
  toHex,
  isTransparent,
  parseStyleInput,
  parsePropInput,
  humanize,
  parseTranslate,
  formatTranslate,
  isArtboardRoot,
  inspect,
  textTarget,
  commitText,
  referencedProps,
  selectionFrom,
  deleteElement,
} from './edit-mode-layer.jsx';

// ── Dock entry point ────────────────────────────────────────────────────────

/**
 * The dock's Edit slot: a plain "Edit" button when off; the edit toolbar when
 * on. The dock passes its own button + separator so everything matches.
 */
export function EditModeDock({ Button, Separator }) {
  const { enabled, selection } = useEditMode();
  if (!enabled) {
    return <Button label="Edit" icon="✎" onClick={toggleEditMode} title="Edit mode — click an element to change it (E)" />;
  }
  return (
    <div className="lm-edock" data-edit-ui role="toolbar" aria-label="Edit">
      <Button label="Done" icon="✎" active onClick={() => setEditEnabled(false)} title="Exit Edit mode (Esc)" />
      <Separator />
      {selection
        ? <ElementControls key={`${selection.stamp}|${selection.slot}`} selection={selection} />
        : <span className="lm-edock-hint" title="Double-click text to type · drag or use arrow keys to move">Click an element to edit</span>}
      <Separator />
      <History />
    </div>
  );
}

function History() {
  const { status, error, canUndo, canRedo } = useEditMode();
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved'
    : status === 'error' ? `Couldn’t save${error ? ` · ${error}` : ''}` : status === 'notice' ? error : '';
  return (
    <React.Fragment>
      <button type="button" className="lm-edock-btn lm-edock-icon" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
      <button type="button" className="lm-edock-btn lm-edock-icon" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
      {!canSave() ? (
        <span className="lm-edock-status lm-edock-status--warn" title="This studio can’t save files. Run `@lerret/cli dev` to save edits.">Preview only</span>
      ) : label ? (
        // keyed on the text: each new status mounts fresh and fades in (CSS @starting-style)
        <span key={label} className={`lm-edock-status lm-edock-status--${status}`} role="status" title={label}>{label}</span>
      ) : null}
    </React.Fragment>
  );
}

// ── The selected element's controls ─────────────────────────────────────────

function ElementControls({ selection }) {
  const ins = useInspector(selection);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef(null);
  const { info, style, isText } = ins;
  const fileName = selection.path.split('/').pop();

  let primary;
  if (!info) {
    primary = <span className="lm-edock-hint">{ins.loadError || 'Loading…'}</span>;
  } else if (style === null) {
    primary = <span className="lm-edock-hint">Styles are set in code</span>;
  } else if (isText) {
    primary = (
      <React.Fragment>
        {ins.field('fontSize', 'Size', { compact: true })}
        {ins.field('fontWeight', 'Weight', { kind: 'weight', compact: true })}
        {ins.field('color', 'Color', { kind: 'swatch' })}
        <AlignControl value={style.textAlign} fallback={ins.computed?.textAlign} onInput={(v) => ins.onStyle('textAlign', v)} />
      </React.Fragment>
    );
  } else {
    primary = (
      <React.Fragment>
        {ins.field(ins.bgKey, 'Fill', { kind: 'swatch' })}
        {ins.field('borderRadius', 'Radius', { compact: true })}
        {ins.field('padding', 'Padding', { compact: true })}
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <span className="lm-edock-tag" title={`<${selection.tag}> in ${fileName}`}>{selection.tag}</span>
      {primary}
      <ElementActions selection={selection} node={ins.first} />
      {info && (
        <button
          ref={moreRef}
          type="button"
          className="lm-edock-btn"
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((o) => !o)}
          title="All properties"
        >
          More
        </button>
      )}
      {moreOpen && info && (
        <MorePopover anchorRef={moreRef} onClose={() => setMoreOpen(false)} ins={ins} selection={selection} fileName={fileName} />
      )}
    </React.Fragment>
  );
}

const ACTION_ICONS = {
  parent: 'M6 13V5h8M6 5l4-4M6 5l4 4',
  duplicate: 'M6 6h8v8H6zM3 11V3h8',
  delete: 'M3 5h12M7 5V3h4v2M5 5l1 10h6l1-10',
};

function ActionButton({ icon, label, onClick, disabled }) {
  return (
    <button type="button" className="lm-edock-btn lm-edock-icon" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <path d={ACTION_ICONS[icon]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </button>
  );
}

/** Select parent · Duplicate · Delete — the element-level actions. */
function ElementActions({ selection, node }) {
  const parent = node?.parentElement?.closest('[data-lerret-src]');
  const hasParent = !!parent && slotOf(parent) === selection.slot;
  const root = node ? isArtboardRoot(node) : true;
  return (
    <span className="lm-edock-group">
      <ActionButton icon="parent" label="Select parent" disabled={!hasParent} onClick={() => selectElement(selectionFrom(parent))} />
      <ActionButton
        icon="duplicate"
        label="Duplicate"
        disabled={root}
        onClick={() => saveSourceEdit(selection.path, selection.offset, { type: 'duplicate', expectTag: selection.tag })}
      />
      <ActionButton icon="delete" label="Delete (⌫)" disabled={root} onClick={() => deleteElement(selection)} />
    </span>
  );
}

/**
 * Everything about the selected element that isn't in the dock row. Reads the
 * source through the engine; writes via the session (debounced for styles).
 */
function useInspector(selection) {
  const { revision } = useEditMode();
  const [info, setInfo] = React.useState(null);
  const [data, setData] = React.useState({});
  const [loadError, setLoadError] = React.useState(null);
  const timers = React.useRef(new Map());
  const originals = React.useRef(new Map());
  const stamp = selection.stamp;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await inspect(selection);
        if (cancelled) return;
        setInfo(next);
        setLoadError(next ? null : 'Couldn’t read this element’s source');
        if (next?.component && referencedProps(next).length) {
          const d = (await readAssetData(selection.assetPath)).value;
          if (!cancelled) setData(d);
        }
      } catch {
        // Dev server gone (stopped, laptop slept) — say so instead of "Loading…" forever.
        if (!cancelled) setLoadError('Can’t reach the Lerret server — is `lerret dev` running?');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, revision]);

  // Flush pending saves when the selection changes or Edit mode closes.
  React.useEffect(() => () => {
    for (const [, t] of timers.current) {
      clearTimeout(t.id);
      t.run();
    }
    timers.current.clear();
  }, []);

  const all = nodesFor(stamp);
  const first = selectedNodes(selection)[0] || all[0];
  const computed = first ? getComputedStyle(first) : null;
  const style = info ? info.style : undefined;

  const preview = (key, value) => {
    for (const n of nodesFor(stamp)) {
      if (!originals.current.has(key)) originals.current.set(key, n.style[key]);
      n.style[key] = value === undefined ? '' : cssValue(key, value);
    }
  };
  // Success re-reads via `revision`; failure puts the previewed value back.
  const afterSave = (res, key) => {
    if (res.ok || !key) return originals.current.delete(key);
    if (!originals.current.has(key)) return undefined;
    for (const n of nodesFor(stamp)) n.style[key] = originals.current.get(key);
    return undefined;
  };
  const schedule = (key, run) => {
    const prev = timers.current.get(key);
    if (prev) clearTimeout(prev.id);
    const t = { run: () => { timers.current.delete(key); run(); } };
    t.id = setTimeout(t.run, SAVE_DELAY_MS);
    timers.current.set(key, t);
  };

  const onStyle = (key, raw) => {
    const original = style?.[key]?.kind === 'literal' ? style[key].value : undefined;
    const value = parseStyleInput(raw, original);
    preview(key, value);
    schedule(`style:${key}`, async () => {
      afterSave(await saveSourceEdit(selection.path, selection.offset,
        { type: 'style', key, value, expectTag: selection.tag }), key);
    });
  };
  const onAttr = async (name, value) => {
    afterSave(await saveSourceEdit(selection.path, selection.offset,
      { type: 'attr', name, value: value === '' ? undefined : value, expectTag: selection.tag }));
  };
  const onProp = (name, value) => {
    setData((d) => ({ ...d, ...(d[selection.variant] && typeof d[selection.variant] === 'object'
      ? { [selection.variant]: { ...d[selection.variant], [name]: value } }
      : { [name]: value }) }));
    schedule(`prop:${name}`, async () => {
      afterSave(await saveDataEdit(selection.assetPath, selection.variant, name, value));
    });
  };

  /** One style control; renders "Set in code" for values we must not rewrite. */
  const field = (key, label, { kind = 'text', compact = false } = {}) => {
    const v = style?.[key];
    if (v && v.kind !== 'literal') {
      return <Field key={key} label={label} compact={compact}><Code title={v.text || v.name} /></Field>;
    }
    const value = v ? String(v.value) : '';
    const shown = computed ? computed[key === 'background' ? 'backgroundColor' : key] : '';
    const onInput = (raw) => onStyle(key, raw);
    if (kind === 'swatch') {
      return <Swatch key={key} label={label} value={value} fallback={shown} onInput={onInput} />;
    }
    return (
      <Field key={key} label={label} compact={compact} kind={kind}>
        {kind === 'color' ? <ColorInput value={value} fallback={shown} label={label} onInput={onInput} />
          : kind === 'weight' ? <SelectInput value={value} options={WEIGHTS} onInput={onInput} />
            : <TextInput value={value} placeholder={shortPlaceholder(shown)} onInput={onInput} />}
      </Field>
    );
  };

  const kind = info?.text.kind;
  return {
    info,
    data,
    loadError,
    style,
    computed,
    first,
    otherArtboards: new Set(all.map(slotOf)).size - 1,
    isText: kind === 'literal' || kind === 'identifier' || kind === 'expression',
    bgKey: style && 'backgroundColor' in style && !('background' in style) ? 'backgroundColor' : 'background',
    target: info ? textTarget(info, selection) : null,
    field,
    onStyle,
    onAttr,
    onProp,
    commitText: (v) => commitText(selection, textTarget(info, selection), v).then((r) => afterSave(r)),
  };
}

// ── "More" popover ──────────────────────────────────────────────────────────

function MorePopover({ anchorRef, onClose, ins, selection, fileName }) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null);

  // Sit above the dock, centered on the More button, kept on screen.
  React.useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current;
      if (!a) return;
      const dock = a.closest('[data-tour="dock"]') || a;
      const ar = a.getBoundingClientRect();
      const dr = dock.getBoundingClientRect();
      const width = 300;
      const left = Math.min(Math.max(ar.left + ar.width / 2 - width / 2, 12), window.innerWidth - width - 12);
      // originX: the More button's center, so the popover grows out of it.
      setPos({ left, bottom: window.innerHeight - dr.top + 8, width, originX: ar.left + ar.width / 2 - left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);

  // Close on Esc (before the canvas sees it) and on a click outside.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose, anchorRef]);

  const { info, style, isText, target, data } = ins;
  const dataName = fileName.replace(/\.[jt]sx?$/, '.data.json');
  const variantNote = selection.variant !== 'default' ? ` (${selection.variant})` : '';
  const props = info.component ? referencedProps(info) : [];
  const moveValue = style?.translate;
  const pos2 = moveValue?.kind === 'literal' ? parseTranslate(moveValue.value) : moveValue ? null : [0, 0];
  const setXY = (x, y) => ins.onStyle('translate', formatTranslate(Number(x) || 0, Number(y) || 0) ?? '');
  const canMove = ins.first && !isArtboardRoot(ins.first);
  const extraKeys = style ? Object.keys(style).filter((k) => !GROUPED.has(k)) : [];
  const attrs = Object.entries(info.attrs).filter(([n]) => EDITABLE_ATTRS.includes(n));

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="lm-edit-pop"
      data-edit-ui
      role="dialog"
      aria-label="Element properties"
      style={{ left: pos.left, bottom: pos.bottom, width: pos.width, transformOrigin: `${pos.originX}px 100%` }}
    >
      <header className="lm-edit-pop__head">
        <span className="lm-edock-tag">{selection.tag}</span>
        <span className="lm-edit-pop__title" title={selection.path}>{fileName}</span>
      </header>
      {ins.otherArtboards > 0 && (
        <p className="lm-edit-note">
          Style and text changes also apply to this element in {ins.otherArtboards === 1 ? '1 other artboard' : `${ins.otherArtboards} other artboards`}.
        </p>
      )}

      {isText && (
        <Section title="Text">
          {target ? (
            <React.Fragment>
              <TextInput
                label="Text"
                multiline
                commitOnBlur
                value={target.kind === 'prop'
                  ? String(dataValueFor(data, selection.variant, target.name) ?? ins.first?.textContent ?? '')
                  : info.text.value}
                onInput={ins.commitText}
              />
              {target.kind === 'prop' && (
                <p className="lm-edit-hint">Prop <code>{target.name}</code> · saved to {dataName}{variantNote}</p>
              )}
            </React.Fragment>
          ) : <Code block />}
          <div className="lm-edit-grid">
            {ins.field('lineHeight', 'Line')}
            {ins.field('letterSpacing', 'Spacing')}
          </div>
        </Section>
      )}

      {style && (
        <React.Fragment>
          <Section title="Appearance">
            {isText && ins.field(ins.bgKey, 'Fill', { kind: 'color' })}
            <div className="lm-edit-grid">
              {ins.field('opacity', 'Opacity')}
              {isText && ins.field('borderRadius', 'Radius')}
            </div>
          </Section>

          <Section title="Layout">
            <div className="lm-edit-grid">
              {ins.field('width', 'W')}
              {ins.field('height', 'H')}
              {isText && ins.field('padding', 'Padding')}
              {ins.field('margin', 'Margin')}
              {/flex|grid/.test(ins.computed?.display || '') && ins.field('gap', 'Gap')}
            </div>
          </Section>

          {canMove && (
            <Section
              title="Position"
              action={pos2 && (pos2[0] || pos2[1]) ? { label: 'Reset', onClick: () => setXY(0, 0) } : null}
            >
              {pos2 ? (
                <div className="lm-edit-grid">
                  <Field label="X"><TextInput value={String(pos2[0])} onInput={(x) => setXY(x, pos2[1])} /></Field>
                  <Field label="Y"><TextInput value={String(pos2[1])} onInput={(y) => setXY(pos2[0], y)} /></Field>
                </div>
              ) : <Code block title={moveValue.text} />}
            </Section>
          )}

          {extraKeys.length > 0 && (
            <Section title="Other styles">
              {extraKeys.map((k) => ins.field(k, humanize(k)))}
            </Section>
          )}
        </React.Fragment>
      )}

      {attrs.length > 0 && (
        <Section title="Attributes">
          {attrs.map(([name, v]) => (
            <Field key={name} label={humanize(name)}>
              {v.kind === 'literal'
                ? <TextInput commitOnBlur value={String(v.value)} onInput={(val) => ins.onAttr(name, val)} />
                : <Code title={v.text || v.name} />}
            </Field>
          ))}
        </Section>
      )}

      {props.length > 0 && (
        <Section title="Props">
          {props.map((name) => {
            const def = info.component.props[name];
            const sample = dataValueFor(data, selection.variant, name) ?? (def?.kind === 'literal' ? def.value : '');
            return (
              <Field key={name} label={name}>
                {typeof sample === 'boolean' ? (
                  <input type="checkbox" checked={sample} onChange={(e) => ins.onProp(name, e.target.checked)} />
                ) : (
                  <TextInput commitOnBlur value={String(sample)} onInput={(v) => ins.onProp(name, parsePropInput(v, sample))} />
                )}
              </Field>
            );
          })}
          <p className="lm-edit-hint">Saved to {dataName}{variantNote}</p>
        </Section>
      )}
    </div>,
    document.body,
  );
}

/** Computed values make useful placeholders only when short ("24px", "normal"). */
function shortPlaceholder(v) {
  return v && v.length <= 12 && !/rgba?\(/.test(v) ? v : '';
}

// ── Small UI pieces ─────────────────────────────────────────────────────────

function Section({ title, action, children }) {
  return (
    <section className="lm-edit-section">
      <div className="lm-edit-section__head">
        <h3>{title}</h3>
        {action && <button type="button" className="lm-edit-link" onClick={action.onClick}>{action.label}</button>}
      </div>
      {children}
    </section>
  );
}

/** A filled well: muted label prefix + borderless input. */
function Field({ label, compact = false, kind, children }) {
  return (
    <label className={`lm-edit-field${compact ? ` lm-edit-field--compact${kind ? ` lm-edit-field--${kind}` : ''}` : ''}`}>
      <span className="lm-edit-field__k">{label}</span>
      {children}
    </label>
  );
}

function Code({ title, block = false }) {
  return (
    <span className={`lm-edit-code${block ? ' lm-edit-code--block' : ''}`} title={title ? `Set in code: ${title}` : 'Set in code'}>
      Set in code
    </span>
  );
}

/**
 * Text input that follows outside updates while unfocused. `onInput` fires on
 * every keystroke (styles: live preview + debounced save) or, with
 * `commitOnBlur`, once on blur / Enter (text, attrs, props).
 */
function TextInput({ value, onInput, placeholder, label, multiline = false, commitOnBlur = false }) {
  const [local, setLocal] = React.useState(value);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (document.activeElement !== ref.current) setLocal(value);
  }, [value]);
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      ref={ref}
      className="lm-input lm-edit-input"
      aria-label={label}
      value={local}
      placeholder={placeholder}
      rows={multiline ? 2 : undefined}
      onChange={(e) => {
        setLocal(e.target.value);
        if (!commitOnBlur) onInput(e.target.value);
      }}
      onBlur={() => {
        if (commitOnBlur && local !== value) onInput(local);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setLocal(value);
        }
      }}
    />
  );
}

function SelectInput({ value, onInput, options }) {
  const known = options.some(([v]) => v === value);
  return (
    <select className="lm-input lm-select lm-edit-input" value={value} onChange={(e) => onInput(e.target.value)}>
      {!known && <option value={value}>{value}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function useFollow(value) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  return [local, setLocal];
}

/** Swatch + hex field (popover). */
function ColorInput({ value, onInput, fallback, label }) {
  const [local, setLocal] = useFollow(value);
  const none = !local && isTransparent(fallback);
  const change = (v) => {
    setLocal(v);
    onInput(v);
  };
  return (
    <span className="lm-edit-color">
      <SwatchChip color={local || fallback} none={none} label={label} onChange={change} />
      <TextInput value={local} placeholder={none ? 'None' : toHex(fallback).toUpperCase()} onInput={change} />
    </span>
  );
}

/** Swatch-only color control (dock row). */
function Swatch({ value, onInput, fallback, label }) {
  const [local, setLocal] = useFollow(value);
  const none = !local && isTransparent(fallback);
  return (
    <span className="lm-edock-swatch" title={`${label}: ${local || (none ? 'none' : toHex(fallback).toUpperCase())}`}>
      <span className="lm-edock-swatch__k">{label}</span>
      <SwatchChip
        color={local || fallback}
        none={none}
        label={label}
        onChange={(v) => {
          setLocal(v);
          onInput(v);
        }}
      />
    </span>
  );
}

function SwatchChip({ color, none, label, onChange }) {
  return (
    <span className={`lm-edit-swatch${none ? ' lm-edit-swatch--none' : ''}`} style={none ? undefined : { background: color }}>
      <input type="color" aria-label={`${label} color`} value={toHex(color)} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

const ALIGN_ICONS = {
  left: 'M2 3h12M2 7h8M2 11h12M2 15h8',
  center: 'M2 3h12M4 7h8M2 11h12M4 15h8',
  right: 'M2 3h12M6 7h8M2 11h12M6 15h8',
};

function AlignControl({ value, fallback, onInput }) {
  if (value && value.kind !== 'literal') return <Field label="Align" compact><Code title={value.text || value.name} /></Field>;
  const current = value ? value.value : '';
  const active = current || (fallback === 'start' ? 'left' : fallback);
  return (
    <div className="lm-edit-seg" role="radiogroup" aria-label="Text align">
      {['left', 'center', 'right'].map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={active === v}
          aria-label={`Align ${v}`}
          title={`Align ${v}`}
          data-set={current === v || undefined}
          onClick={() => onInput(current === v ? '' : v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 18" aria-hidden="true">
            <path d={ALIGN_ICONS[v]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      ))}
    </div>
  );
}
