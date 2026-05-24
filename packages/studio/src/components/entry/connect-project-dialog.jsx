// connect-project-dialog.jsx — in-session "Switch project" modal (CLI mode).
//
// The no-project CliConnectScreen (open-folder.jsx) is the full-screen connect
// surface. THIS is its modal twin: invoked from the brand menu's "Switch
// project…" while a project is already open, so the user picks the new folder
// WITHOUT first losing their current canvas. On a successful switch the server
// broadcasts the new model over `lerret:change` and the canvas swaps in place;
// the dialog closes itself.
//
// Same mechanism as the connect screen: paste a folder path (the local CLI
// needs a real path, which the browser FSA picker can't provide) or pick a
// recent, then POST `/__lerret/switch-folder` via `switchProject`.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { switchProject, fetchRecentProjects } from '../../runtime/write-client.js';

/**
 * @param {object} props
 * @param {() => void} props.onClose  Dismiss the dialog (Cancel / Esc / backdrop).
 * @returns {React.ReactElement}
 */
export function ConnectProjectDialog({ onClose }) {
 const [folderInput, setFolderInput] = React.useState('');
 const [connecting, setConnecting] = React.useState(false);
 const [connectError, setConnectError] = React.useState(null);
 const [recents, setRecents] = React.useState([]);
 const inputRef = React.useRef(null);

 // Load recents + focus the field on open.
 React.useEffect(() => {
 let cancelled = false;
 fetchRecentProjects().then((list) => {
 if (!cancelled) setRecents(Array.isArray(list) ? list : []);
 });
 if (inputRef.current) inputRef.current.focus();
 return () => {
 cancelled = true;
 };
 }, []);

 // Esc closes.
 React.useEffect(() => {
 const onKey = (e) => {
 if (e.key === 'Escape') {
 e.preventDefault();
 onClose();
 }
 };
 document.addEventListener('keydown', onKey);
 return () => document.removeEventListener('keydown', onKey);
 }, [onClose]);

 const connect = React.useCallback(async (folder) => {
 const target = (folder || '').trim();
 if (!target) {
 setConnectError('Enter a folder path to connect.');
 return;
 }
 setConnecting(true);
 setConnectError(null);
 const result = await switchProject(target);
 if (!result.ok) {
 setConnectError(result.error || 'Could not connect to that folder.');
 setConnecting(false);
 return;
 }
 // Success: the broadcast swaps the canvas; close the dialog.
 onClose();
 }, [onClose]);

 const onSubmit = (e) => {
 e.preventDefault();
 connect(folderInput);
 };

 const fieldStyle = {
 flex: 1,
 minWidth: 0,
 padding: '10px 12px',
 fontSize: 13,
 fontFamily: 'var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace)',
 color: '#1A1714',
 background: '#FAF8F2',
 border: '1px solid #DDD7CA',
 borderRadius: 8,
 outline: 'none',
 boxSizing: 'border-box',
 };
 const primaryBtn = {
 padding: '10px 18px',
 borderRadius: 8,
 border: 'none',
 background: connecting ? 'rgba(184,91,51,0.6)' : '#B85B33',
 color: '#FAF8F2',
 fontFamily: 'inherit',
 fontSize: 13,
 fontWeight: 600,
 cursor: connecting ? 'wait' : 'pointer',
 };

 return ReactDOM.createPortal(
 <div
 role="presentation"
 onMouseDown={(e) => {
 if (e.target === e.currentTarget) onClose();
 }}
 style={{
 position: 'fixed',
 inset: 0,
 background: 'rgba(26,23,20,0.38)',
 backdropFilter: 'blur(2px)',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 zIndex: 120,
 padding: 24,
 }}
 data-testid="connect-project-dialog"
 >
 <div
 role="dialog"
 aria-modal="true"
 aria-label="Switch project"
 style={{
 width: '100%',
 maxWidth: 460,
 background: '#FAF8F2',
 border: '1px solid #DDD7CA',
 borderRadius: 14,
 boxShadow: '0 24px 60px rgba(15,23,42,0.28)',
 padding: 22,
 display: 'flex',
 flexDirection: 'column',
 gap: 16,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 }}
 >
 <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
 <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1A1714' }}>Switch project</h2>
 <p style={{ margin: 0, fontSize: 12, color: '#6E6960', lineHeight: 1.5 }}>
 Connect the studio to a different folder that contains a <code>.lerret/</code> project.
 </p>
 </div>

 <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={onSubmit}>
 <div style={{ display: 'flex', gap: 8 }}>
 <input
 ref={inputRef}
 type="text"
 style={fieldStyle}
 placeholder="/path/to/your/project"
 value={folderInput}
 onChange={(e) => setFolderInput(e.target.value)}
 disabled={connecting}
 aria-label="Project folder path"
 data-testid="connect-dialog-input"
 />
 <button type="submit" style={primaryBtn} disabled={connecting} data-testid="connect-dialog-connect">
 {connecting ? 'Connecting…' : 'Connect'}
 </button>
 </div>
 {connectError && (
 <p role="alert" style={{ margin: 0, fontSize: 12, color: '#A8412B' }} data-testid="connect-dialog-error">
 {connectError}
 </p>
 )}
 </form>

 {recents.length > 0 && (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
 <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9a958c' }}>
 Recent projects
 </span>
 <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }} data-testid="connect-dialog-recents">
 {recents.map((r) => (
 <li key={r.path}>
 <button
 type="button"
 onClick={() => connect(r.path)}
 disabled={connecting}
 data-testid="connect-dialog-recent"
 style={{
 display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
 width: '100%', padding: '8px 12px', textAlign: 'left',
 background: '#fff', border: '1px solid #DDD7CA', borderRadius: 8,
 cursor: connecting ? 'default' : 'pointer', fontFamily: 'inherit',
 }}
 onMouseEnter={(e) => { if (!connecting) e.currentTarget.style.borderColor = '#B85B33'; }}
 onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#DDD7CA'; }}
 >
 <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1714' }}>{r.name}</span>
 <span style={{ fontSize: 10, fontFamily: 'var(--lm-font-mono, monospace)', color: '#B8B3A8' }}>{r.path}</span>
 </button>
 </li>
 ))}
 </ul>
 </div>
 )}

 <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
 <button
 type="button"
 onClick={onClose}
 data-testid="connect-dialog-cancel"
 style={{
 padding: '8px 16px', borderRadius: 8,
 border: '1px solid rgba(26,23,20,0.14)', background: 'transparent',
 color: '#3A3530', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
 }}
 >
 Cancel
 </button>
 </div>
 </div>
 </div>,
 document.body,
 );
}

export default ConnectProjectDialog;
