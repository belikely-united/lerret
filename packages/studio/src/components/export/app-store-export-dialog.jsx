// app-store-export-dialog.jsx — "Export for App Store…" from a page/group menu.
//
// Shows what will be exported (grouped by the device App Store Connect asks
// for), what won't (not an App Store size — with the size, so the fix is
// obvious), then downloads one ZIP of exact-size JPGs. Uses the shared modal
// shell + motion (`.lm-motion-modal` in motion.css).

import React from 'react';
import * as ReactDOM from 'react-dom';

import { collectAppStoreDesigns, buildAppStoreZip, downloadBlob, APP_STORE_SIZES } from '../../export/app-store.js';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.42)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--lm-font-sans, system-ui)',
};

const sheetStyle = {
  background: 'var(--lm-bg-primary, #FFFFFF)',
  color: 'var(--lm-text-primary, #0A0A0A)',
  borderRadius: 16,
  padding: 24,
  width: 420,
  maxWidth: '90vw',
  maxHeight: '80vh',
  overflowY: 'auto',
  boxShadow: 'var(--lm-shadow-popup, 0 16px 48px rgba(0, 0, 0, 0.16))',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  fontSize: 13,
};

const listStyle = {
  margin: 0,
  padding: 12,
  listStyle: 'none',
  borderRadius: 12,
  background: 'var(--lm-bg-secondary, #F5F5F5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const btn = (primary, enabled = true) => ({
  border: 'none',
  borderRadius: 999,
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.5,
  background: primary ? 'var(--lm-accent, #111111)' : 'var(--lm-bg-tertiary, #EBEBEB)',
  color: primary ? '#fff' : 'inherit',
});

/**
 * @param {{ sectionId: string, title: string, onClose: () => void }} props
 */
export function AppStoreExportDialog({ sectionId, title, onClose }) {
  const [found] = React.useState(() => {
    const root = [...document.querySelectorAll('[data-dc-section]')].find((n) => n.getAttribute('data-dc-section') === sectionId);
    return root ? collectAppStoreDesigns(root) : { ready: [], skipped: [] };
  });
  const [progress, setProgress] = React.useState(null); // { done, total } | null
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !progress) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, progress]);

  const byDevice = APP_STORE_SIZES.map(({ device }) => [device, found.ready.filter((d) => d.device === device)]).filter(([, l]) => l.length);
  const hasRequired = found.ready.some((d) => d.device === 'iPhone 6.9″');

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: found.ready.length });
    try {
      const { blob, failed } = await buildAppStoreZip(found.ready, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      downloadBlob(blob, `${title || 'App Store'} screenshots.zip`);
      if (failed.length) {
        setError(`Couldn’t export ${failed.join(', ')}.`);
        setProgress(null);
      } else onClose();
    } catch (err) {
      setError(err?.message || String(err));
      setProgress(null);
    }
  };

  return ReactDOM.createPortal(
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Export for App Store" className="lm-motion-modal" style={sheetStyle} data-testid="lm-appstore-export">
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Export for App Store</h2>
          <div style={{ fontSize: 12, color: 'var(--lm-text-tertiary, #6B6B6B)', marginTop: 2 }}>from {title}</div>
        </div>

        {found.ready.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--lm-text-secondary, #404040)', lineHeight: 1.5 }}>
            Nothing here is an App Store screenshot size yet. Make one with <b>+ New asset → App Store</b>, or change a
            design’s size from the size label above it.
          </p>
        ) : (
          <ul style={listStyle} data-testid="lm-appstore-ready">
            {byDevice.map(([device, list]) => (
              <li key={device} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span><b>{device}</b> · {list.map((d) => d.label).join(', ')}</span>
                <span style={{ color: 'var(--lm-text-tertiary, #6B6B6B)', whiteSpace: 'nowrap' }}>{list.length}</span>
              </li>
            ))}
          </ul>
        )}

        {found.ready.length > 0 && !hasRequired && (
          <p style={{ margin: 0, color: 'var(--lm-warning, #B54708)', lineHeight: 1.5 }}>
            App Store Connect requires iPhone 6.9″ screenshots (1320×2868). Add at least one at that size.
          </p>
        )}

        {found.skipped.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--lm-text-tertiary, #6B6B6B)', marginBottom: 6 }}>
              Not included — not an App Store size
            </div>
            <ul style={{ ...listStyle, background: 'transparent', padding: 0 }} data-testid="lm-appstore-skipped">
              {found.skipped.map((d, i) => (
                <li key={`${d.label}-${i}`} style={{ color: 'var(--lm-text-secondary, #404040)' }}>
                  {d.label} <span style={{ color: 'var(--lm-text-tertiary, #6B6B6B)' }}>· {d.width}×{d.height}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p style={{ margin: 0, color: 'var(--lm-error, #D92D20)' }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="lm-focusable" style={btn(false, !progress)} onClick={onClose} disabled={!!progress}>
            Cancel
          </button>
          <button
            type="button"
            className="lm-focusable"
            style={btn(true, found.ready.length > 0 && !progress)}
            onClick={run}
            disabled={found.ready.length === 0 || !!progress}
            data-testid="lm-appstore-download"
          >
            {progress ? `Exporting ${progress.done} of ${progress.total}…` : `Download ZIP (${found.ready.length})`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default AppStoreExportDialog;
