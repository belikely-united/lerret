// ObjectControl.jsx — nested object group control.
//
// Renders a sub-control for each declared property in `schema.properties`.
// When `properties` is absent the object's current keys are rendered as
// text fields (best-effort display for unknown shapes).
//
// Commit model: commits the full updated object on every sub-field commit.

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
 // If no properties are declared, derive keys from the current value.
 const keys =
 Object.keys(properties).length > 0
 ? Object.keys(properties)
 : Object.keys(obj);

 const handleSubChange = (key, v) => {
 const next = { ...obj, [key]: v };
 onChange?.(next);
 onCommit?.(next);
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
 return (
 <FormControl
 key={key}
 fieldKey={key}
 schema={subSchema}
 value={Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined}
 onChange={(v) => handleSubChange(key, v)}
 onCommit={(v) => handleSubChange(key, v)}
 disabled={disabled}
 />
 );
 })}
 {keys.length === 0 && (
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
