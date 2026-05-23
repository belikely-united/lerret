// ObjectControl.jsx — nested object group control.
//
// Renders a sub-control for each declared property in `schema.properties`.
// When `properties` is absent the object is treated as FREE-FORM: its current
// keys are rendered as editable rows, and the user can add their own key/value
// pairs (a "+ Add" row) or remove existing ones (a × per row). This is what
// makes `vars` / `colors` / `fonts` / `liveRefresh` authorable from the visual
// editor — no raw-JSON detour required.
//
// Commit model: commits the full updated object on every sub-field commit,
// add, or remove.

import React from 'react';
import { validateField } from './validate.js';
import { FieldWrapper } from './FieldWrapper.jsx';
import { FormControl } from './FormControl.jsx';
import './form-controls.css';

/**
 * Object (nested group) control.
 *
 * @param {object} props
 * @param {string} props.fieldKey
 * @param {import('./validate.js').FieldSchema} props.schema
 * @param {Record<string, unknown> | undefined | null} props.value
 * @param {(v: Record<string, unknown>) => void} [props.onChange]
 * @param {(v: Record<string, unknown>) => void} [props.onCommit]
 * @param {boolean} [props.disabled]
 */
export function ObjectControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const obj = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

 const validation = validateField(value !== null && value !== undefined ? value : undefined, schema);
 const invalid = !validation.valid;

 const properties = schema?.properties ?? {};
 const declared = Object.keys(properties);
 // No declared properties → free-form object: keys come from the value, and
 // the user may add / remove their own key/value pairs.
 const freeForm = declared.length === 0;
 const keys = freeForm ? Object.keys(obj) : declared;

 // New-property key input (free-form only).
 const [newKey, setNewKey] = React.useState('');

 const handleSubChange = (key, v) => {
 const next = { ...obj, [key]: v };
 onChange?.(next);
 onCommit?.(next);
 };

 const handleRemove = (key) => {
 const next = { ...obj };
 delete next[key];
 onChange?.(next);
 onCommit?.(next);
 };

 const trimmedNew = newKey.trim();
 const isDuplicate = Object.prototype.hasOwnProperty.call(obj, trimmedNew);
 const canAdd = !disabled && trimmedNew.length > 0 && !isDuplicate;

 const handleAdd = () => {
 if (!canAdd) return;
 // Seed the new key with an empty string; its sub-control then lets the
 // user type the value (and a number/boolean is just typed as text — the
 // raw-JSON fallback remains for richer shapes).
 handleSubChange(trimmedNew, '');
 setNewKey('');
 };

 return (
 <FieldWrapper
 fieldKey={fieldKey}
 required={schema?.required}
 description={schema?.description}
 invalid={invalid}
 invalidMessage={validation.message}
 >
 <div className="lm-object" data-control-type="object">
 {keys.map((key) => {
 const subSchema = properties[key] ?? { type: 'string' };
 const control = (
 <FormControl
 fieldKey={key}
 schema={subSchema}
 value={Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined}
 onChange={(v) => handleSubChange(key, v)}
 onCommit={(v) => handleSubChange(key, v)}
 disabled={disabled}
 />
 );
 // Declared keys are fixed — render the control as-is.
 if (!freeForm) return <React.Fragment key={key}>{control}</React.Fragment>;
 // Free-form keys get a remove affordance.
 return (
 <div className="lm-object__row" key={key}>
 <div className="lm-object__row-field">{control}</div>
 <button
 type="button"
 className="lm-icon-btn lm-object__remove"
 onClick={() => handleRemove(key)}
 disabled={disabled}
 aria-label={`Remove ${key}`}
 title={`Remove ${key}`}
 >
 ×
 </button>
 </div>
 );
 })}

 {freeForm && (
 <div className="lm-object__add" data-object-add>
 <input
 type="text"
 className="lm-object__add-key"
 value={newKey}
 onChange={(e) => setNewKey(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') {
 e.preventDefault();
 handleAdd();
 }
 }}
 placeholder="new property name"
 aria-label={`New ${fieldKey} property name`}
 disabled={disabled}
 spellCheck={false}
 autoCorrect="off"
 autoCapitalize="off"
 data-object-add-key
 />
 <button
 type="button"
 className="lm-object__add-btn"
 onClick={handleAdd}
 disabled={!canAdd}
 aria-label={`Add property to ${fieldKey}`}
 data-object-add-btn
 >
 + Add
 </button>
 </div>
 )}

 {!freeForm && keys.length === 0 && (
 <p
 style={{
 margin: 0,
 fontFamily: 'var(--lm-font-sans)',
 fontSize: 'var(--lm-size-body-sm, 12px)',
 color: 'var(--lm-text-muted, #B8B3A8)',
 }}
 >
 No properties defined.
 </p>
 )}
 </div>
 </FieldWrapper>
 );
}
