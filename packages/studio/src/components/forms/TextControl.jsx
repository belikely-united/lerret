// TextControl.jsx — string field control.
//
// Renders a plain <input type="text"> wrapped in FieldWrapper.
//
// Verb-free commit model: commits on blur; also debounces onChange after
// DEBOUNCE_MS of inactivity. This means hosts can listen to onCommit for a
// stable "user has finished editing" signal, or onChange for fine-grained
// updates.
//
// Invalid state: renders the invalid class + an inline message via FieldWrapper.
// The control never blocks input or commit — it only annotates.

import React, { useId, useState, useRef, useCallback, useEffect } from 'react';
import { validateField } from './validate.js';
import { FieldWrapper } from './FieldWrapper.jsx';
import './form-controls.css';

const DEBOUNCE_MS = 300;

/**
 * Text (string) control.
 *
 * @param {object} props
 * @param {string} props.fieldKey — Schema key → label.
 * @param {import('./validate.js').FieldSchema} props.schema
 * @param {string | undefined | null} props.value
 * @param {(v: string) => void} [props.onChange] — fired debounced on typing.
 * @param {(v: string) => void} [props.onCommit] — fired on blur.
 * @param {boolean} [props.disabled]
 */
export function TextControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const id = useId();
 const [local, setLocal] = useState(value ?? '');
 const timerRef = useRef(null);

 // Sync when controlled value changes externally.
 useEffect(() => {
 setLocal(value ?? '');
 }, [value]);

 const validation = validateField(local !== '' ? local : undefined, schema);
 const invalid = !validation.valid;

 const clearTimer = useCallback(() => {
 if (timerRef.current !== null) {
 clearTimeout(timerRef.current);
 timerRef.current = null;
 }
 }, []);

 const handleChange = useCallback(
 (e) => {
 const v = e.target.value;
 setLocal(v);
 clearTimer();
 timerRef.current = setTimeout(() => {
 onChange?.(v);
 }, DEBOUNCE_MS);
 },
 [onChange, clearTimer],
 );

 const handleBlur = useCallback(
 (e) => {
 clearTimer();
 const v = e.target.value;
 onChange?.(v);
 onCommit?.(v);
 },
 [onChange, onCommit, clearTimer],
 );

 // Schema default → placeholder ghost text.
 const placeholder =
 schema?.default !== undefined && schema.default !== null
 ? String(schema.default)
 : undefined;

 return (
 <FieldWrapper
 fieldKey={fieldKey}
 inputId={id}
 required={schema?.required}
 description={schema?.description}
 invalid={invalid}
 invalidMessage={validation.message}
 >
 <input
 id={id}
 type="text"
 className={['lm-input', invalid ? 'lm-input--invalid' : ''].filter(Boolean).join(' ')}
 value={local}
 onChange={handleChange}
 onBlur={handleBlur}
 disabled={disabled}
 placeholder={placeholder}
 aria-invalid={invalid ? 'true' : undefined}
 aria-required={schema?.required ? 'true' : undefined}
 data-control-type="text"
 />
 </FieldWrapper>
 );
}
