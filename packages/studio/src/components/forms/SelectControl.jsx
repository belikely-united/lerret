// SelectControl.jsx — enumerated-string select control.
//
// Uses a native <select> so we get:
// - Arrow-key navigation out of the box (browser handles Up/Down in the list).
// - Full keyboard accessibility without re-implementing a popover.
// - Screen-reader semantics for free.
//
// Commit model: commits on change (native select fires change on selection).
// Also commits on blur to flush any pending value if the host needs it.

import React, { useId } from 'react';
import { validateField } from './validate.js';
import { FieldWrapper } from './FieldWrapper.jsx';
import './form-controls.css';

/**
 * Select (enumerated string) control.
 *
 * @param {object} props
 * @param {string} props.fieldKey
 * @param {import('./validate.js').FieldSchema} props.schema — must include `options: string[]`.
 * @param {string | undefined | null} props.value
 * @param {(v: string) => void} [props.onChange]
 * @param {(v: string) => void} [props.onCommit]
 * @param {boolean} [props.disabled]
 */
export function SelectControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const id = useId();
 const options = Array.isArray(schema?.options) ? schema.options : [];

 const validation = validateField(value !== null && value !== undefined ? value : undefined, schema);
 const invalid = !validation.valid;

 const handleChange = (e) => {
 const v = e.target.value;
 onChange?.(v);
 onCommit?.(v);
 };

 // Show the schema default as the "placeholder" option when no value is set.
 const hasValue = value !== null && value !== undefined && value !== '';
 const schemaDefault = typeof schema?.default === 'string' ? schema.default : '';

 return (
 <FieldWrapper
 fieldKey={fieldKey}
 inputId={id}
 required={schema?.required}
 description={schema?.description}
 invalid={invalid}
 invalidMessage={validation.message}
 >
 <select
 id={id}
 className={[
 'lm-input',
 'lm-select',
 invalid ? 'lm-input--invalid' : '',
 ]
 .filter(Boolean)
 .join(' ')}
 value={hasValue ? value : ''}
 onChange={handleChange}
 onBlur={handleChange}
 disabled={disabled}
 aria-invalid={invalid ? 'true' : undefined}
 aria-required={schema?.required ? 'true' : undefined}
 data-control-type="select"
 >
 {/* Ghost placeholder option when value is absent */}
 {!hasValue && (
 <option value="" disabled={schema?.required}>
 {schemaDefault !== '' ? schemaDefault : 'Select…'}
 </option>
 )}
 {options.map((opt) => (
 <option key={opt} value={opt}>
 {opt}
 </option>
 ))}
 </select>
 </FieldWrapper>
 );
}
