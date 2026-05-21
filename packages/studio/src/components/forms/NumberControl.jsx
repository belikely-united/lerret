// NumberControl.jsx — numeric field control.
//
// Renders a <input type="number"> wrapped in FieldWrapper.
//
// Commit model: commits the parsed float on blur, debounced on change.
// If the raw text cannot parse as a finite number it is committed as NaN,
// which validateField then flags as invalid — the control never blocks.
//
// Arrow-key step increments the value by 1 (default) or schema.step when set.

import React, { useId, useState, useRef, useCallback, useEffect } from 'react';
import { validateField } from './validate.js';
import { FieldWrapper } from './FieldWrapper.jsx';
import './form-controls.css';

const DEBOUNCE_MS = 300;

/**
 * Number control.
 *
 * @param {object} props
 * @param {string} props.fieldKey
 * @param {import('./validate.js').FieldSchema} props.schema
 * @param {number | undefined | null} props.value
 * @param {(v: number) => void} [props.onChange]
 * @param {(v: number) => void} [props.onCommit]
 * @param {boolean} [props.disabled]
 */
export function NumberControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const id = useId();
 // Keep raw text while the user is typing; parse on commit.
 const [local, setLocal] = useState(value !== undefined && value !== null ? String(value) : '');
 const timerRef = useRef(null);

 useEffect(() => {
 setLocal(value !== undefined && value !== null ? String(value) : '');
 }, [value]);

 const parseValue = (s) => {
 const n = parseFloat(s);
 return Number.isFinite(n) ? n : undefined;
 };

 const currentParsed = parseValue(local);
 const validation = validateField(currentParsed, schema);
 const invalid = !validation.valid;

 const clearTimer = useCallback(() => {
 if (timerRef.current !== null) {
 clearTimeout(timerRef.current);
 timerRef.current = null;
 }
 }, []);

 const handleChange = useCallback(
 (e) => {
 const s = e.target.value;
 setLocal(s);
 clearTimer();
 timerRef.current = setTimeout(() => {
 const n = parseValue(s);
 if (n !== undefined) onChange?.(n);
 }, DEBOUNCE_MS);
 },
 [onChange, clearTimer],
 );

 const handleBlur = useCallback(
 (e) => {
 clearTimer();
 const s = e.target.value;
 const n = parseValue(s);
 if (n !== undefined) {
 onChange?.(n);
 onCommit?.(n);
 }
 },
 [onChange, onCommit, clearTimer],
 );

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
 type="number"
 className={['lm-input', invalid ? 'lm-input--invalid' : ''].filter(Boolean).join(' ')}
 value={local}
 onChange={handleChange}
 onBlur={handleBlur}
 disabled={disabled}
 placeholder={placeholder}
 min={schema?.min}
 max={schema?.max}
 aria-invalid={invalid ? 'true' : undefined}
 aria-required={schema?.required ? 'true' : undefined}
 data-control-type="number"
 />
 </FieldWrapper>
 );
}
