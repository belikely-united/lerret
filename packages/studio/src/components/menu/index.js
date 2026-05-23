// packages/studio/src/components/menu/index.js
// Barrel — re-export the Menu primitive and its companions.

export { Menu, MenuItem, MenuSeparator } from './Menu.jsx';
export { KebabTrigger } from './kebab-trigger.jsx';
export {
 EntityKebab,
 ComponentEditorHost,
 MarkdownEditorHost,
 SectionEditorHost,
 buildComponentItems,
 buildMarkdownItems,
 buildSectionItems,
 applyDeleteConfirm,
 create,
 duplicate,
 destroy,
 move,
 reveal,
 inCliMode,
} from './entity-kebab.jsx';
export { MovePicker } from './move-picker.jsx';
export { CreateEntryDialog } from './create-entry-dialog.jsx';
export { ConfirmDialog } from './confirm-dialog.jsx';
export { default } from './Menu.jsx';
