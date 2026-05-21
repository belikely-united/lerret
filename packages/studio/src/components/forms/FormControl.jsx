// FormControl.jsx — unified schema-driven control dispatcher.
//
// A single `<FormControl schema={fragment} fieldKey="..." value={...} onChange={...} />`
// that picks the appropriate typed control from `schema.type`.
//
// Supported types:
// 'string' → TextControl
// 'number' → NumberControl
// 'boolean' → BooleanControl
// 'select' → SelectControl
// 'array' → ArrayControl
// 'object' → ObjectControl
//
// Unknown types fall back to TextControl so they are still editable.

import React from 'react';
import { TextControl } from './TextControl.jsx';
import { NumberControl } from './NumberControl.jsx';
import { BooleanControl } from './BooleanControl.jsx';
import { SelectControl } from './SelectControl.jsx';
import { ArrayControl } from './ArrayControl.jsx';
import { ObjectControl } from './ObjectControl.jsx';

/**
 * Unified schema-driven form control.
 *
 * @param {object} props
 * @param {string} props.fieldKey — Schema key; becomes the label.
 * @param {import('./validate.js').FieldSchema} props.schema — Schema fragment for this field.
 * @param {unknown} props.value — Current value.
 * @param {(v: unknown) => void} [props.onChange] — Debounced; fires during typing.
 * @param {(v: unknown) => void} [props.onCommit] — Fires on blur / selection.
 * @param {boolean} [props.disabled]
 */
export function FormControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const type = schema?.type ?? 'string';

 const sharedProps = { fieldKey, schema, value, onChange, onCommit, disabled };

 switch (type) {
 case 'string':
 return <TextControl {...sharedProps} />;
 case 'number':
 return <NumberControl {...sharedProps} />;
 case 'boolean':
 return <BooleanControl {...sharedProps} />;
 case 'select':
 return <SelectControl {...sharedProps} />;
 case 'array':
 return <ArrayControl {...sharedProps} />;
 case 'object':
 return <ObjectControl {...sharedProps} />;
 default:
 // Unknown type — render as text so the field is still usable.
 return <TextControl {...sharedProps} schema={{ ...schema, type: 'string' }} />;
 }
}
