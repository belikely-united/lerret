// ArrayControl.jsx — repeating-group array control.
//
// Renders a list of items, each editable via the control matching
// `schema.itemSchema.type`. Supports add / remove / reorder — all
// accessible by keyboard.
//
// Keyboard bindings on reorder buttons: standard Tab / Enter / Space.
// Add / remove buttons are also keyboard-reachable via Tab.
//
// Commit model: commits the full updated array on every item change, item
// addition, removal, and reorder. Each array action is immediate; there is
// no buffer.
//
// When no itemSchema is specified the items are rendered as TextControls
// (strings).

import React, { useCallback } from 'react';
import { validateField } from './validate.js';
import { FieldWrapper } from './FieldWrapper.jsx';
// FormControl is imported here for recursive rendering (array of arrays, etc.).
// ESM circular imports are safe for React components — they are resolved by
// render time, not module-init time.
import { FormControl } from './FormControl.jsx';
import './form-controls.css';

/**
 * Array control — repeating group with add / remove / reorder.
 *
 * @param {object} props
 * @param {string} props.fieldKey
 * @param {import('./validate.js').FieldSchema} props.schema
 * @param {unknown[] | undefined | null} props.value
 * @param {(v: unknown[]) => void} [props.onChange]
 * @param {(v: unknown[]) => void} [props.onCommit]
 * @param {boolean} [props.disabled]
 */
export function ArrayControl({ fieldKey, schema, value, onChange, onCommit, disabled }) {
 const items = Array.isArray(value) ? value : [];
 const itemSchema = schema?.itemSchema ?? { type: 'string' };

 const validation = validateField(value !== null && value !== undefined ? value : undefined, schema);
 const invalid = !validation.valid;

 const commit = useCallback(
 (next) => {
 onChange?.(next);
 onCommit?.(next);
 },
 [onChange, onCommit],
 );

 const handleItemChange = useCallback(
 (idx, v) => {
 const next = items.slice();
 next[idx] = v;
 commit(next);
 },
 [items, commit],
 );

 const handleAdd = useCallback(() => {
 const defaultItem =
 itemSchema?.default !== undefined
 ? itemSchema.default
 : itemSchema?.type === 'boolean'
 ? false
 : itemSchema?.type === 'number'
 ? 0
 : '';
 commit([...items, defaultItem]);
 }, [items, itemSchema, commit]);

 const handleRemove = useCallback(
 (idx) => {
 const next = items.filter((_, i) => i !== idx);
 commit(next);
 },
 [items, commit],
 );

 const handleMoveUp = useCallback(
 (idx) => {
 if (idx === 0) return;
 const next = items.slice();
 [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
 commit(next);
 },
 [items, commit],
 );

 const handleMoveDown = useCallback(
 (idx) => {
 if (idx === items.length - 1) return;
 const next = items.slice();
 [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
 commit(next);
 },
 [items, commit],
 );

 return (
 <FieldWrapper
 fieldKey={fieldKey}
 required={schema?.required}
 description={schema?.description}
 invalid={invalid}
 invalidMessage={validation.message}
 >
 <div className="lm-array" data-control-type="array">
 <div className="lm-array__items" role="list">
 {items.map((item, idx) => (
 <div
 key={idx}
 className="lm-array__item"
 role="listitem"
 data-array-index={idx}
 >
 <div className="lm-array__item-field">
 <FormControl
 fieldKey={`${fieldKey}[${idx}]`}
 schema={itemSchema}
 value={item}
 onChange={(v) => handleItemChange(idx, v)}
 onCommit={(v) => handleItemChange(idx, v)}
 disabled={disabled}
 />
 </div>
 <div className="lm-array__item-actions">
 {/* Move up */}
 <button
 type="button"
 className="lm-icon-btn"
 onClick={() => handleMoveUp(idx)}
 disabled={disabled || idx === 0}
 aria-label={`Move item ${idx + 1} up`}
 title="Move up"
 data-array-move-up={idx}
 >
 ↑
 </button>
 {/* Move down */}
 <button
 type="button"
 className="lm-icon-btn"
 onClick={() => handleMoveDown(idx)}
 disabled={disabled || idx === items.length - 1}
 aria-label={`Move item ${idx + 1} down`}
 title="Move down"
 data-array-move-down={idx}
 >
 ↓
 </button>
 {/* Remove */}
 <button
 type="button"
 className="lm-icon-btn lm-icon-btn--danger"
 onClick={() => handleRemove(idx)}
 disabled={disabled}
 aria-label={`Remove item ${idx + 1}`}
 title="Remove"
 data-array-remove={idx}
 >
 ×
 </button>
 </div>
 </div>
 ))}
 </div>

 {/* Add button */}
 <button
 type="button"
 className="lm-array__add"
 onClick={handleAdd}
 disabled={disabled}
 aria-label={`Add item to ${fieldKey}`}
 data-array-add
 >
 + Add item
 </button>
 </div>
 </FieldWrapper>
 );
}
