// FieldWrapper.jsx — Schema-driven label + description + invalid message wrapper.
//
// Wraps any control with:
// • A label row derived from the schema key (with a required indicator).
// • An optional help text from `schema.description`.
// • An optional invalid message row (icon + text — not color alone, UX-DR18).
//
// labelling, description, required marker, invalid state rendering.

import React from 'react';
import './form-controls.css';

// ─── Inline invalid icon (exclamation circle) — mirrors asset-error-card ──────
function InvalidIcon() {
 return (
 <svg
 className="lm-field__invalid-icon"
 aria-hidden="true"
 focusable="false"
 viewBox="0 0 16 16"
 fill="none"
 xmlns="http://www.w3.org/2000/svg"
 >
 <circle cx="8" cy="8" r="7.25" stroke="currentColor" strokeWidth="1.5" />
 <line
 x1="8" y1="4.5" x2="8" y2="9"
 stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
 />
 <circle cx="8" cy="11.5" r="0.875" fill="currentColor" />
 </svg>
 );
}

/**
 * Schema-driven field wrapper — label, description, invalid message.
 *
 * @param {object} props
 * @param {string} props.fieldKey — The schema key; used as the visible label.
 * @param {string} [props.inputId] — The `id` of the control inside, used in `for=`.
 * @param {boolean} [props.required] — From `schema.required`; adds a red asterisk.
 * @param {string} [props.description] — From `schema.description`; shown as help text.
 * @param {boolean} [props.invalid] — Whether the current value is invalid.
 * @param {string | null} [props.invalidMessage] — The message when invalid.
 * @param {React.ReactNode} props.children — The actual control element.
 */
export function FieldWrapper({
 fieldKey,
 inputId,
 required,
 description,
 invalid,
 invalidMessage,
 children,
}) {
 // Convert camelCase / snake_case key → readable label.
 const label = fieldKey
 ? fieldKey
 .replace(/([A-Z])/g, ' $1')
 .replace(/_/g, ' ')
 .trim()
 : '';

 return (
 <div className="lm-field" data-field-key={fieldKey}>
 {/* Label row */}
 <div className="lm-field__label-row">
 <label
 className="lm-field__label"
 htmlFor={inputId}
 >
 {label}
 </label>
 {required && (
 <span
 className="lm-field__required"
 aria-label="required"
 title="This field is required"
 >
 *
 </span>
 )}
 </div>

 {/* Control slot */}
 {children}

 {/* Description / help text */}
 {description && (
 <p className="lm-field__description">{description}</p>
 )}

 {/* Invalid message — icon + text so state is not color-only (UX-DR18) */}
 {invalid && invalidMessage && (
 <div
 className="lm-field__invalid-msg"
 role="alert"
 aria-live="polite"
 data-invalid-message
 >
 <InvalidIcon />
 <span>Invalid: {invalidMessage}</span>
 </div>
 )}
 </div>
 );
}
