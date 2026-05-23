// page-picker.jsx — the studio dock's page control: switch, create, delete.
//
// Originally a switch-only picker (UX-DR1). It is now the project's PAGE
// MANAGER — the single home for page lifecycle, so the dock no longer needs a
// separate "+ New" button:
//
// • Switch — pick a page; the canvas swaps to it (hash-driven, no reload).
// • Create — "+ New page" opens the shared CreateEntryDialog, then navigates
//   to the new page.
// • Delete — a trash affordance on each page row opens a confirm dialog with a
//   warning (a page delete removes the page and everything inside it).
//
// Create / delete write to disk, so they are CLI-only (`inCliMode()`); in
// hosted / standalone mode the picker stays a pure switcher.
//
// Keyboard: ArrowUp/Down move the highlight across page rows, Home/End jump,
// Enter/Space switch, Esc closes. The per-row delete and the "+ New page"
// action are reachable by mouse and by Tab once the list is open.
//
// The listbox is portaled to <body> so the dock's `overflow` cannot clip it.

import React from 'react';
import * as ReactDOM from 'react-dom';

import {
  create,
  destroy,
  inCliMode,
  CreateEntryDialog,
  ConfirmDialog,
} from '../menu/index.js';

// A small chevron — rotates when the picker is open.
function PickerChevron({ open }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 11 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      style={{
        opacity: 0.55,
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 120ms ease',
        flex: 'none',
      }}
    >
      <path d="M2 4l3.5 3.5L9 4" />
    </svg>
  );
}

// A small pages glyph for the trigger — reads as "page navigation".
function PagesGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none', opacity: 0.8 }}
    >
      <path d="M3.5 1.5h3L9 4v6.5h-5.5z" />
      <path d="M2.5 3.5v6.5H8" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 3.5h9M5 3.5V2.5h4v1M5.5 6v4M8.5 6v4M3.5 3.5l.6 7a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-7" />
    </svg>
  );
}

/**
 * Find a page node in the project model by its path, returning child counts for
 * the delete warning.
 *
 * @param {object | null | undefined} projectModel
 * @param {string} pageId
 * @returns {{ groups: number, assets: number }}
 */
function pageChildCounts(projectModel, pageId) {
  const node = (projectModel?.pages || []).find((p) => p.path === pageId);
  return {
    groups: node ? (node.groups || []).length : 0,
    assets: node ? (node.assets || []).length : 0,
  };
}

/**
 * The dock's page picker / manager.
 *
 * @param {object} props
 * @param {{ id: string, label: string }[]} props.pages
 * @param {string} props.current
 * @param {(id: string) => void} props.onNavigate
 * @param {object} [props.projectModel]
 *   The loaded ProjectNode — required for create (parent path) and the delete
 *   warning's child counts. Omitted in non-project (brownfield) mode.
 * @returns {React.ReactElement | null}
 */
export function PagePicker({ pages, current, onNavigate, projectModel }) {
  const list = Array.isArray(pages) ? pages : [];
  const manage = inCliMode() && !!projectModel;

  // Zero pages: in CLI mode offer a "+ New page" entry point in the dock (the
  // canvas also shows a no-pages notice). Otherwise nothing to render.
  if (list.length === 0) {
    return manage ? (
      <PageManagerZero projectModel={projectModel} onNavigate={onNavigate} />
    ) : null;
  }

  // Non-managed single page — a plain static label (nothing to pick or manage).
  if (list.length === 1 && !manage) {
    return <PagePickerStaticLabel label={list[0].label} />;
  }

  return (
    <PagePickerDropdown
      pages={list}
      current={current}
      onNavigate={onNavigate}
      projectModel={projectModel}
      manage={manage}
    />
  );
}

/**
 * Zero-pages CLI affordance — a compact "+ New page" button + the create dialog.
 */
function PageManagerZero({ projectModel, onNavigate }) {
  const [open, setOpen] = React.useState(false);
  const onConfirm = async ({ name }) => {
    const result = await create(projectModel.path, name, 'folder', {});
    if (!result?.ok) throw new Error(result?.error || 'Create failed');
    if (result.path) onNavigate(result.path);
  };
  return (
    <span data-tour="dock-pages" style={{ display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="page-picker-new-zero"
        style={triggerButtonStyle(false)}
      >
        <span style={{ display: 'inline-flex', color: 'var(--lm-text-tertiary, #6e6960)' }}>
          <PagesGlyph />
        </span>
        <span>+ New page</span>
      </button>
      {open && (
        <CreateEntryDialog
          kind="page"
          existingNames={[]}
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/**
 * The single-page non-managed case — a plain, non-interactive label.
 */
function PagePickerStaticLabel({ label }) {
  return (
    <span
      data-tour="dock-pages"
      data-page-picker="static"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 12px',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--lm-text-secondary, #3a3530)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--lm-text-tertiary, #6e6960)' }}>
        <PagesGlyph />
      </span>
      <span>{label}</span>
    </span>
  );
}

function triggerButtonStyle(open) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    background: open ? 'rgba(0,0,0,0.06)' : 'transparent',
    color: 'var(--lm-text-secondary, #3a3530)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 120ms ease',
    whiteSpace: 'nowrap',
    maxWidth: 240,
  };
}

/**
 * The dropdown: switch pages + (in manage mode) create / delete them.
 */
function PagePickerDropdown({ pages, current, onNavigate, projectModel, manage }) {
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [coords, setCoords] = React.useState(null);
  // Create / delete dialog state.
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteState, setDeleteState] = React.useState(null); // { id, label, groups, assets }
  const rootRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const listRef = React.useRef(null);

  const currentIdx = Math.max(0, pages.findIndex((p) => p.id === current));
  const currentPage = pages[currentIdx] || pages[0];

  const measure = React.useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ left: r.left, bottom: window.innerHeight - r.top });
  }, []);

  const openList = React.useCallback(() => {
    setActiveIdx(currentIdx);
    measure();
    setOpen(true);
  }, [currentIdx, measure]);

  const closeList = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus && triggerRef.current) triggerRef.current.focus();
  }, []);

  const pick = React.useCallback(
    (idx) => {
      const page = pages[idx];
      if (page && page.id !== current) onNavigate(page.id);
      closeList();
    },
    [pages, current, onNavigate, closeList],
  );

  // Outside pointerdown closes the list — but NOT when a create/delete dialog is
  // open (those portal to <body>, outside the list, and own their own dismiss).
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (createOpen || deleteState) return;
      const inTrigger = rootRef.current && rootRef.current.contains(e.target);
      const inList = listRef.current && listRef.current.contains(e.target);
      if (!inTrigger && !inList) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, createOpen, deleteState]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [open, measure]);

  React.useEffect(() => {
    if (open && listRef.current) listRef.current.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector('[data-page-active="true"]');
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeIdx]);

  const onTriggerKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openList();
    }
  };

  const onListKeyDown = React.useCallback(
    (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % pages.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + pages.length) % pages.length);
          break;
        case 'Home':
          e.preventDefault();
          setActiveIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIdx(pages.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          pick(activeIdx);
          break;
        case 'Escape':
          e.preventDefault();
          closeList();
          break;
        case 'Tab':
          closeList(false);
          break;
        default:
          break;
      }
    },
    [pages.length, activeIdx, pick, closeList],
  );

  React.useEffect(() => {
    if (!open) return undefined;
    const node = listRef.current;
    if (!node) return undefined;
    node.addEventListener('keydown', onListKeyDown);
    return () => node.removeEventListener('keydown', onListKeyDown);
  }, [open, onListKeyDown]);

  // Create-page handler.
  const onConfirmCreate = async ({ name }) => {
    const result = await create(projectModel.path, name, 'folder', {});
    if (!result?.ok) throw new Error(result?.error || 'Create failed');
    setOpen(false);
    if (result.path) onNavigate(result.path);
  };

  // Delete-page handler — navigates away if deleting the current page.
  const onConfirmDelete = async () => {
    const id = deleteState.id;
    const result = await destroy(id);
    if (!result?.ok) throw new Error(result?.error || 'Delete failed');
    setOpen(false);
    if (id === current) {
      const next = pages.find((p) => p.id !== id);
      if (next) onNavigate(next.id);
    }
  };

  const listboxId = 'lerret-page-picker-listbox';
  const optionId = (idx) => `lerret-page-picker-option-${idx}`;
  const pageNames = (projectModel?.pages || []).map((p) => p.name);

  return (
    <span
      ref={rootRef}
      data-tour="dock-pages"
      data-page-picker="dropdown"
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Page: ${currentPage.label}. Switch, create, or delete pages`}
        title="Pages"
        style={triggerButtonStyle(open)}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ display: 'inline-flex', color: 'var(--lm-text-tertiary, #6e6960)' }}>
          <PagesGlyph />
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentPage.label}</span>
        <PickerChevron open={open} />
      </button>

      {open && coords &&
        ReactDOM.createPortal(
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label="Pages"
            aria-activedescendant={optionId(activeIdx)}
            style={{
              position: 'fixed',
              bottom: coords.bottom + 8,
              left: coords.left,
              listStyle: 'none',
              margin: 0,
              minWidth: 220,
              maxWidth: 320,
              maxHeight: 320,
              overflowY: 'auto',
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(16px) saturate(120%)',
              WebkitBackdropFilter: 'blur(16px) saturate(120%)',
              border: '1px solid rgba(26,23,20,0.10)',
              borderRadius: 12,
              padding: 6,
              boxShadow: '0 12px 32px rgba(15,23,42,0.18), 0 1px 3px rgba(15,23,42,0.06)',
              zIndex: 80,
              outline: 'none',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
            }}
          >
            <li
              aria-hidden="true"
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--lm-text-muted, #9a958c)',
                padding: '6px 12px 6px',
              }}
            >
              Pages
            </li>
            {pages.map((page, idx) => {
              const isCurrent = page.id === current;
              const isActive = idx === activeIdx;
              return (
                <li
                  key={page.id}
                  id={optionId(idx)}
                  role="option"
                  aria-selected={isCurrent}
                  data-page-active={isActive}
                  onClick={() => pick(idx)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 8px 8px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isCurrent ? 600 : 500,
                    color: 'var(--lm-text-primary, #1a1714)',
                    background: isActive ? 'var(--lm-accent-light, rgba(184,91,51,0.10))' : 'transparent',
                    boxShadow: isActive ? 'inset 0 0 0 1.5px var(--lm-accent, #B85B33)' : 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 12, display: 'inline-flex', justifyContent: 'center', color: 'var(--lm-accent, #B85B33)' }}
                  >
                    {isCurrent ? (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 5.8L4.4 8.2 9 2.8" />
                      </svg>
                    ) : null}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.label}
                  </span>
                  {manage && (
                    <button
                      type="button"
                      title={`Delete page "${page.label}"`}
                      aria-label={`Delete page "${page.label}"`}
                      data-testid="page-picker-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        const counts = pageChildCounts(projectModel, page.id);
                        setDeleteState({ id: page.id, label: page.label, ...counts });
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24,
                        height: 24,
                        flex: 'none',
                        borderRadius: 6,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--lm-text-tertiary, #6e6960)',
                        cursor: 'pointer',
                        transition: 'background .12s, color .12s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--lm-error-light, rgba(168,65,43,0.12))';
                        e.currentTarget.style.color = 'var(--lm-error, #A8412B)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--lm-text-tertiary, #6e6960)';
                      }}
                    >
                      <TrashGlyph />
                    </button>
                  )}
                </li>
              );
            })}
            {manage && (
              <React.Fragment>
                <li aria-hidden="true" style={{ height: 1, background: 'rgba(60,50,40,0.10)', margin: '6px 8px' }} />
                <li style={{ listStyle: 'none' }}>
                  <button
                    type="button"
                    data-testid="page-picker-new"
                    onClick={() => setCreateOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--lm-accent, #B85B33)',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lm-accent-light, rgba(184,91,51,0.10))')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span aria-hidden="true" style={{ width: 12, textAlign: 'center', fontSize: 15, lineHeight: 1 }}>+</span>
                    New page
                  </button>
                </li>
              </React.Fragment>
            )}
          </ul>,
          document.body,
        )}

      {createOpen && (
        <CreateEntryDialog
          kind="page"
          existingNames={pageNames}
          onConfirm={onConfirmCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {deleteState && (
        <ConfirmDialog
          title={`Delete page "${deleteState.label}"?`}
          destructive
          confirmLabel="Delete page"
          message={
            <>
              This permanently deletes the page
              {deleteState.groups + deleteState.assets > 0 ? (
                <>
                  {' '}and everything inside it
                  {' '}
                  (<strong>
                    {deleteState.groups > 0
                      ? `${deleteState.groups} group${deleteState.groups === 1 ? '' : 's'}`
                      : null}
                    {deleteState.groups > 0 && deleteState.assets > 0 ? ', ' : null}
                    {deleteState.assets > 0
                      ? `${deleteState.assets} asset${deleteState.assets === 1 ? '' : 's'}`
                      : null}
                  </strong>)
                </>
              ) : null}
              . This can&rsquo;t be undone.
            </>
          }
          onConfirm={onConfirmDelete}
          onClose={() => setDeleteState(null)}
        />
      )}
    </span>
  );
}

export default PagePicker;
