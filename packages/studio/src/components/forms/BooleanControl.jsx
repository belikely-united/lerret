// BooleanControl.jsx — boolean toggle control.
//
// A visually styled toggle track + thumb that is fully keyboard-operable:
// - Space / Enter toggle the value (handled by <button role="switch">).
// - Tab reaches it; Tab again leaves it.
//
// The underlying element is a <button role="switch"> rather than a <input
// type="checkbox"> so we get consistent cross-browser keyboard events and
// can style the track + thumb freely, while keeping correct ARIA semantics.
//
// Commit model: commits immediately on toggle (booleans have no partial state).

import React, { useId } from 'react';
import { validateField } from './validate.js';
import { FieldWrapper } from './FieldWrapper.jsx';
import './form-controls.css';

/**
 * Boolean toggle control.
 *
 * @param {object} props
 * @param {string} props.fieldKey
 * @param {import('./validate.js').FieldSchema} props.schema
 * @param {boolean | undefined | null} props.value
 * @param {(v: boolean) => void} [props.onChange]
 * @param {(v: boolean) => void} [props.onCommit]
 * @param {boolean} [props.disabled]
 */
export function BooleanControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const id = useId();

 // Resolve effective value — fall back to schema default, then false.
 const schemaDefault = typeof schema?.default === 'boolean' ? schema.default : false;
 const checked = value !== null && value !== undefined ? Boolean(value) : schemaDefault;

 const validation = validateField(value !== null && value !== undefined ? value : undefined, schema);
 const invalid = !validation.valid;

 const handleToggle = () => {
 if (disabled) return;
 const next = !checked;
 onChange?.(next);
 onCommit?.(next);
 };

 const handleKeyDown = (e) => {
 if (e.key === ' ' || e.key === 'Enter') {
 e.preventDefault();
 handleToggle();
 }
 };

 const trackClasses = [
 'lm-toggle__track',
 checked ? 'lm-toggle__track--on' : '',
 invalid ? 'lm-toggle__track--invalid' : '',
 disabled ? 'lm-toggle__track--disabled' : '',
 ]
 .filter(Boolean)
 .join(' ');

 return (
 <FieldWrapper
 fieldKey={fieldKey}
 inputId={id}
 required={schema?.required}
 description={schema?.description}
 invalid={invalid}
 invalidMessage={validation.message}
 >
 <div className="lm-toggle">
 <button
 id={id}
 role="switch"
 aria-checked={checked}
 aria-required={schema?.required ? 'true' : undefined}
 aria-invalid={invalid ? 'true' : undefined}
 aria-label={fieldKey}
 className={trackClasses}
 onClick={handleToggle}
 onKeyDown={handleKeyDown}
 disabled={disabled}
 type="button"
 data-control-type="boolean"
 >
 <span className="lm-toggle__thumb" aria-hidden="true" />
 </button>
 <span className="lm-toggle__label" aria-hidden="true">
 {checked ? 'On' : 'Off'}
 </span>
 </div>
 </FieldWrapper>
 );
}
