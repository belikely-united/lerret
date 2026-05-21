// index.js — barrel for the forms library.
//
// Exports:
// FormControl — unified dispatcher; renders the right control from schema.type.
// TextControl — string input.
// NumberControl — numeric input.
// BooleanControl — boolean toggle (Space/Enter to toggle).
// SelectControl — enumerated-string native select (arrow-key navigation).
// ArrayControl — repeating group with add / remove / reorder.
// ObjectControl — nested property group.
// validateField — (value, schema) → { valid, message } — pure helper.
//
// Schema fragment shape (FieldSchema):
// {
// type: 'string' | 'number' | 'boolean' | 'select' | 'array' | 'object'
// default?: any // ghost placeholder when field is empty
// required?: boolean // marks field required; shows asterisk
// description?: string // shown as help text below the control
// options?: string[] // required when type === 'select'
// min?: number // lower bound (number only)
// max?: number // upper bound (number only)
// itemSchema?: FieldSchema // schema for each item (array only)
// properties?: Record<string, FieldSchema> // sub-schemas (object only)
// }

export { FormControl } from './FormControl.jsx';
export { TextControl } from './TextControl.jsx';
export { NumberControl } from './NumberControl.jsx';
export { BooleanControl } from './BooleanControl.jsx';
export { SelectControl } from './SelectControl.jsx';
export { ArrayControl } from './ArrayControl.jsx';
export { ObjectControl } from './ObjectControl.jsx';
export { validateField } from './validate.js';
