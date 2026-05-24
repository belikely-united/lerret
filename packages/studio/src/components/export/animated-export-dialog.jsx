// animated-export-dialog.jsx — in-studio dialog for animated export (FR63, FR64).
//
// This file is the SINGLE call-site of `await import('@lerret/animation')` in
// the studio (per the dynamic-import boundary invariant from Story 7.0 and
// architecture-epic-7.md §Pattern Extensions). No other studio module may
// statically import `@lerret/animation`.
//
// Lifecycle:
//   1. User clicks "Export animated…" in a kebab menu.
//   2. The dialog opens with settings (duration, FPS, format, scale, loop,
//      capture mode, output filename).
//   3. User clicks Capture → we dynamic-import @lerret/animation, build an
//      encoder, run `captureToEncoder(element, encoder, …)`, and download the
//      resulting Blob.
//   4. If @lerret/animation is missing, render an honest degradation message
//      and offer no Capture button — static (PNG/JPG) export is unaffected.

import React from 'react';
import * as ReactDOM from 'react-dom';
import { zipSync } from 'fflate';

import { suspendLiveRefresh } from '../canvas/live-refresh-suspend.js';
import { loadExportPrefs, saveExportPrefs } from './export-prefs.js';

const DEFAULT_SETTINGS = Object.freeze({
    durationMs: 3000,
    fps: 24,
    format: 'webp',
    scale: 1,
    loop: 'infinite',
});

// Free-input bounds for the numeric Duration / FPS fields.
const MIN_DURATION_SEC = 0.1;
const MAX_DURATION_SEC = 60;
const MIN_FPS = 1;
const MAX_FPS = 60;

// Note: for LIVE content (clock/counter), the effective frame rate is bounded
// by how fast html-to-image can rasterize the artboard — at 60 fps the capture
// duplicates frames to stay anchored to real time (see frame-capture.js). The
// container is still authored at the chosen fps; the playback SPEED is always
// correct regardless of which fps is selected.
const FPS_OPTIONS = [10, 24, 30, 60];
const DURATION_OPTIONS = [
    { label: '1s', value: 1000 },
    { label: '3s', value: 3000 },
    { label: '5s', value: 5000 },
];
// Format is the lead decision — rendered as segmented pills (all options
// visible, one click) with an adaptive helper line. Short labels for the pills;
// the helper conveys each format's tradeoff so the user picks by intent, not
// jargon. (Scale was removed: the artboard's own `meta.dimensions` are the
// authoritative export size — 2×/3× was an advanced retina need that just
// inflated file size and capture time.)
const FORMAT_OPTIONS = [
    { label: 'WebP', value: 'webp' },
    { label: 'GIF', value: 'gif' },
    { label: 'APNG', value: 'apng' },
    { label: 'MP4', value: 'mp4' },
];
const FORMAT_HINTS = {
    webp: 'Smallest file, supports transparency. Preview in a browser — macOS Finder / Quick Look may show only the first frame.',
    gif: 'Plays in virtually every app. Larger file, limited to 256 colors.',
    apng: 'Lossless quality with transparency. Larger file than WebP.',
    mp4: 'Video — tiny file, but no transparency and no looping.',
};

const overlayStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,15,15,0.42)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--lm-font-sans, system-ui)',
};

const sheetStyle = {
    background: 'var(--lm-bg-primary, #fdfaf3)',
    color: 'var(--lm-text-primary, #1A1714)',
    borderRadius: 14,
    padding: 24,
    minWidth: 420,
    maxWidth: 520,
    boxShadow: '0 24px 64px rgba(15,23,42,0.28)',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
};

const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--lm-text-secondary, #6E6960)',
    marginBottom: 6,
    display: 'block',
};

const inputBase = {
    border: '1px solid var(--lm-border, rgba(26,23,20,0.18))',
    background: 'transparent',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    color: 'inherit',
};

const segGroupStyle = { display: 'flex', gap: 6 };

/** One pill in the Format segmented control. */
function segButtonStyle(active) {
    return {
        flex: '1 1 0',
        minWidth: 0,
        padding: '8px 6px',
        borderRadius: 8,
        cursor: 'pointer',
        border: active
            ? '1px solid var(--lm-accent, #B85B33)'
            : '1px solid var(--lm-border, rgba(26,23,20,0.18))',
        background: active ? 'var(--lm-accent, #B85B33)' : 'transparent',
        color: active ? '#fff' : 'inherit',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        fontFamily: 'inherit',
        transition: 'background .12s, border-color .12s, color .12s',
    };
}

const fieldHintStyle = {
    fontSize: 11,
    color: 'var(--lm-text-secondary, #6E6960)',
    lineHeight: 1.4,
    marginTop: 6,
    opacity: 0.9,
};

const buttonPrimary = {
    background: 'var(--lm-accent, #B85B33)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
};

const buttonSecondary = {
    background: 'transparent',
    color: 'inherit',
    border: '1px solid var(--lm-border, rgba(26,23,20,0.18))',
    borderRadius: 8,
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
};

/**
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {Element} props.element          DOM element to capture.
 * @param {string} props.assetName         Used as the default filename root.
 * @param {{ width: number, height: number }} props.dimensions
 * @param {Array<{ element: Element, name: string, dimensions: { width:number, height:number } }>} [props.bulkItems]
 *   When provided, the dialog runs a bulk export over multiple artboards and
 *   downloads the result as a ZIP. Mutually exclusive with the per-artboard mode.
 * @param {string} [props.bulkZipName]     Default filename for the bulk ZIP.
 * @param {string} [props.persistKey]
 *   Stable per-asset id (the artboard's `entry.id`). Export settings are
 *   remembered under this key and restored next time the dialog opens for the
 *   same asset. Omit for bulk export — it reads/writes only the global "last
 *   used" fallback.
 */
export function AnimatedExportDialog({
    onClose,
    element,
    assetName,
    dimensions,
    bulkItems,
    bulkZipName,
    persistKey,
}) {
    const isBulk = Array.isArray(bulkItems) && bulkItems.length > 0;
    // Restore remembered settings for this asset (per-asset → global → defaults).
    // Computed once via a ref so re-renders don't re-read storage or clobber
    // in-progress edits.
    const initialRef = React.useRef(null);
    if (initialRef.current === null) {
        initialRef.current = loadExportPrefs(isBulk ? null : persistKey);
    }
    const initialSettings = initialRef.current;
    const [settings, setSettings] = React.useState(initialSettings);
    const [filename, setFilename] = React.useState(
        () => (isBulk ? bulkZipName || 'animated-export.zip' : `${assetName || 'export'}.${initialSettings.format}`),
    );
    const [animationModule, setAnimationModule] = React.useState(null);
    const [moduleError, setModuleError] = React.useState(null);
    const [phase, setPhase] = React.useState('idle'); // 'idle' | 'capturing' | 'done' | 'failed'
    const [progressText, setProgressText] = React.useState('');
    const [errorMsg, setErrorMsg] = React.useState(null);
    const abortRef = React.useRef(null);
    const dialogRef = React.useRef(null);

    // Free-text mirrors for the numeric Duration (seconds) + FPS fields so the
    // user can type freely; we commit a clamped number to `settings` on each
    // valid keystroke and normalize the display on blur.
    const [durationSecStr, setDurationSecStr] = React.useState(
        String(initialSettings.durationMs / 1000),
    );
    const [fpsStr, setFpsStr] = React.useState(String(initialSettings.fps));

    const onDurationInput = (raw) => {
        setDurationSecStr(raw);
        const sec = Number(raw);
        if (Number.isFinite(sec) && sec >= MIN_DURATION_SEC && sec <= MAX_DURATION_SEC) {
            setSettings((s) => ({ ...s, durationMs: Math.round(sec * 1000) }));
        }
    };
    const onDurationBlur = () => {
        let sec = Number(durationSecStr);
        if (!Number.isFinite(sec) || sec <= 0) sec = DEFAULT_SETTINGS.durationMs / 1000;
        sec = Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, sec));
        setDurationSecStr(String(sec));
        setSettings((s) => ({ ...s, durationMs: Math.round(sec * 1000) }));
    };
    const onFpsInput = (raw) => {
        setFpsStr(raw);
        const n = Number(raw);
        if (Number.isFinite(n) && n >= MIN_FPS && n <= MAX_FPS) {
            setSettings((s) => ({ ...s, fps: Math.round(n) }));
        }
    };
    const onFpsBlur = () => {
        let n = Number(fpsStr);
        if (!Number.isFinite(n) || n <= 0) n = DEFAULT_SETTINGS.fps;
        n = Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(n)));
        setFpsStr(String(n));
        setSettings((s) => ({ ...s, fps: n }));
    };

    // Update filename suggestion when format changes (per-artboard mode only).
    React.useEffect(() => {
        if (isBulk) return;
        setFilename((current) => {
            const base = (current || '').replace(/\.(webp|gif|apng|mp4)$/i, '');
            return `${base || assetName || 'export'}.${settings.format}`;
        });
    }, [settings.format, assetName, isBulk]);

    // Suspend the studio's auto-refresh timer while the dialog is IDLE. Without
    // this, an auto-refresh tick on the asset being exported reloads its
    // artboard subtree mid-interaction and dismisses any open native `<select>`
    // popup — the user can't pick a Format/FPS/Duration on a live page.
    //
    // BUT the suspend must be LIFTED during capture: 'now' mode snapshots the
    // LIVE asset over the chosen duration, so if the asset's only motion comes
    // from auto-refresh (the common case — a clock/countdown with no internal
    // timer), a held suspend freezes it and the export is a still frame at the
    // correct length. So `handleCapture` releases this and re-acquires it after.
    // Stored in a ref so the capture path can toggle it. Released on unmount.
    const suspendReleaseRef = React.useRef(null);
    React.useEffect(() => {
        suspendReleaseRef.current = suspendLiveRefresh();
        return () => {
            if (suspendReleaseRef.current) {
                suspendReleaseRef.current();
                suspendReleaseRef.current = null;
            }
        };
    }, []);

    // Lazy-import @lerret/animation. The single dynamic-import call-site for
    // the studio per the boundary invariant.
    React.useEffect(() => {
        let cancelled = false;
        import('@lerret/animation')
            .then((mod) => {
                if (!cancelled) setAnimationModule(mod);
            })
            .catch((err) => {
                if (!cancelled) {
                    setModuleError(
                        err && err.message ? err.message : 'Animation package not available.',
                    );
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Esc closes; focus is trapped while open.
    React.useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') {
                if (phase === 'capturing') {
                    abortRef.current?.abort();
                }
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        dialogRef.current?.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, phase]);

    const setOne = (patch) => setSettings((s) => ({ ...s, ...patch }));

    const handleCapture = async () => {
        if (!animationModule) return;
        setErrorMsg(null);
        setProgressText('Preparing…');
        setPhase('capturing');
        abortRef.current = new AbortController();
        // Lift the idle-suspend so auto-refresh re-renders the asset DURING
        // capture — otherwise 'now' mode records a frozen frame for assets whose
        // motion is auto-refresh-driven. No dropdown is open during capture, so
        // the reason the suspend exists doesn't apply here. Re-acquired below.
        if (suspendReleaseRef.current) {
            suspendReleaseRef.current();
            suspendReleaseRef.current = null;
        }
        try {
            if (isBulk) {
                await runBulkAnimatedExport({
                    bulkItems,
                    settings,
                    animationModule,
                    onProgress: (i, total, label) => setProgressText(`${label} ${i}/${total}…`),
                    signal: abortRef.current.signal,
                    filename,
                });
            } else {
                await runSingleAnimatedExport({
                    element,
                    dimensions,
                    settings,
                    animationModule,
                    onProgress: (i, total) => setProgressText(`Frame ${i}/${total}…`),
                    signal: abortRef.current.signal,
                    filename,
                });
            }
            // Remember these settings for next time — per-asset, plus the
            // global "last used" fallback. Only on a successful capture, so a
            // cancelled/abandoned tweak doesn't get persisted.
            saveExportPrefs(isBulk ? null : persistKey, settings);
            setPhase('done');
            setTimeout(() => onClose(), 600);
        } catch (err) {
            if (err && err.code === 'CAPTURE_CANCELLED') {
                setPhase('idle');
                setProgressText('');
                return;
            }
            setErrorMsg(err && err.message ? err.message : String(err));
            setPhase('failed');
        } finally {
            // Re-suspend while the dialog stays open (done/failed/cancelled all
            // keep it open or close shortly after) so idle dropdown protection
            // is restored. On a successful close the unmount cleanup releases it.
            if (!suspendReleaseRef.current) {
                suspendReleaseRef.current = suspendLiveRefresh();
            }
        }
    };

    // Portal to <body> so the dialog escapes the canvas's `transform`-based
    // zoom/pan container. A `position: fixed` element nested inside a
    // transformed ancestor is anchored to that ancestor (its containing block
    // becomes the transformed element, not the viewport), so without a portal
    // the dialog would pan/scale with the canvas. Body-portaled = viewport-
    // centered regardless of canvas zoom.
    if (typeof document === 'undefined') return null;
    return ReactDOM.createPortal(
        <div style={overlayStyle} onClick={(e) => {
            if (e.target === e.currentTarget && phase !== 'capturing') onClose();
        }}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={isBulk ? 'Export all artboards animated' : 'Export artboard animated'}
                tabIndex={-1}
                style={sheetStyle}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                        {isBulk
                            ? `Export ${bulkItems.length} artboards animated`
                            : `Export ${assetName || 'artboard'} animated`}
                    </h2>
                    {moduleError && (
                        <span style={{ fontSize: 11, color: '#B85B33' }}>animation unavailable</span>
                    )}
                </div>

                {moduleError ? (
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--lm-text-secondary, #6E6960)' }}>
                        Animated export is not available — your install is missing <code>@lerret/animation</code>.
                        Run <code>pnpm add @lerret/animation</code> (or your runner's equivalent) to enable.
                        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{moduleError}</div>
                    </div>
                ) : (
                    <>
                        {/* Format — the lead decision. Segmented pills show all
                            four options at once (one click, no menu), and the
                            adaptive helper line below explains the tradeoff so
                            the user picks by intent. The WebP browser-preview
                            caveat lives in that helper now (no separate block). */}
                        <div>
                            <span style={labelStyle}>Format</span>
                            <div style={segGroupStyle} role="group" aria-label="Export format">
                                {FORMAT_OPTIONS.map((o) => {
                                    const active = settings.format === o.value;
                                    return (
                                        <button
                                            key={o.value}
                                            type="button"
                                            aria-pressed={active}
                                            style={segButtonStyle(active)}
                                            onClick={() => setOne({ format: o.value })}
                                        >
                                            {o.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={fieldHintStyle}>{FORMAT_HINTS[settings.format]}</div>
                        </div>

                        {/* The two numeric knobs, side by side. */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                            <Field label="Duration (s)">
                                <input
                                    type="number"
                                    min={MIN_DURATION_SEC}
                                    max={MAX_DURATION_SEC}
                                    step="0.5"
                                    list="lm-duration-presets"
                                    value={durationSecStr}
                                    onChange={(e) => onDurationInput(e.target.value)}
                                    onBlur={onDurationBlur}
                                    style={{ ...inputBase, width: '100%' }}
                                    aria-label="Duration in seconds"
                                />
                                <datalist id="lm-duration-presets">
                                    {DURATION_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value / 1000} />
                                    ))}
                                </datalist>
                            </Field>
                            <Field label="FPS">
                                <input
                                    type="number"
                                    min={MIN_FPS}
                                    max={MAX_FPS}
                                    step="1"
                                    list="lm-fps-presets"
                                    value={fpsStr}
                                    onChange={(e) => onFpsInput(e.target.value)}
                                    onBlur={onFpsBlur}
                                    style={{ ...inputBase, width: '100%' }}
                                    aria-label="Frames per second"
                                />
                                <datalist id="lm-fps-presets">
                                    {FPS_OPTIONS.map((v) => (
                                        <option key={v} value={v} />
                                    ))}
                                </datalist>
                            </Field>
                        </div>

                        {/* Loop — collapsed from a 3-option menu to a single
                            checkbox: forever (default) vs once covers ~all real
                            cases. Hidden for MP4 (no loop metadata). */}
                        {settings.format !== 'mp4' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.loop === 'infinite'}
                                    onChange={(e) => setOne({ loop: e.target.checked ? 'infinite' : 'once' })}
                                />
                                Loop forever
                            </label>
                        )}

                        {!isBulk && (
                            <Field label="Filename">
                                <input
                                    type="text"
                                    value={filename}
                                    onChange={(e) => setFilename(e.target.value)}
                                    style={{ ...inputBase, width: '100%' }}
                                />
                            </Field>
                        )}

                        {progressText && (
                            <div style={{ fontSize: 12, color: 'var(--lm-text-secondary, #6E6960)' }}>
                                {progressText}
                            </div>
                        )}

                        {errorMsg && (
                            <div style={{ fontSize: 12, color: '#B85B33', lineHeight: 1.4 }}>
                                {errorMsg}
                            </div>
                        )}
                    </>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                    {phase === 'capturing' ? (
                        <button
                            type="button"
                            style={buttonSecondary}
                            onClick={() => abortRef.current?.abort()}
                        >Cancel</button>
                    ) : (
                        <button
                            type="button"
                            style={buttonSecondary}
                            onClick={onClose}
                        >Close</button>
                    )}
                    {!moduleError && (
                        <button
                            type="button"
                            style={{
                                ...buttonPrimary,
                                opacity: phase === 'capturing' ? 0.6 : 1,
                                cursor: phase === 'capturing' ? 'wait' : 'pointer',
                            }}
                            onClick={handleCapture}
                            disabled={phase === 'capturing' || !animationModule}
                        >
                            {phase === 'capturing' ? 'Capturing…' : phase === 'done' ? 'Done' : 'Capture'}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function Field({ label, children }) {
    return (
        <div>
            <span style={labelStyle}>{label}</span>
            {children}
        </div>
    );
}

async function runSingleAnimatedExport({
    element,
    dimensions,
    settings,
    animationModule,
    onProgress,
    signal,
    filename,
}) {
    const { createEncoder, captureToEncoder } = animationModule;
    const width = Math.round(dimensions.width * settings.scale);
    const height = Math.round(dimensions.height * settings.scale);
    const encoder = await createEncoder(settings.format, {
        width,
        height,
        fps: settings.fps,
        loop: settings.loop,
    });
    // Always wall-clock: capture exactly the user's chosen duration at the
    // chosen fps, regardless of what the live asset is doing. The old 'cycle'
    // mode (capture one liveRefresh interval, ignore duration) confused users
    // and silently dropped their duration — removed from the dialog.
    const blob = await captureToEncoder(element, encoder, {
        mode: 'now',
        durationMs: settings.durationMs,
        fps: settings.fps,
        scale: settings.scale,
        signal,
        onProgress,
    });
    triggerDownload(blob, filename);
}

async function runBulkAnimatedExport({
    bulkItems,
    settings,
    animationModule,
    onProgress,
    signal,
    filename,
}) {
    const { createEncoder, captureToEncoder } = animationModule;
    /** @type {Record<string, Uint8Array>} */
    const entries = {};
    let i = 0;
    for (const item of bulkItems) {
        if (signal?.aborted) {
            throw Object.assign(new Error('cancelled'), { code: 'CAPTURE_CANCELLED' });
        }
        i += 1;
        onProgress?.(i, bulkItems.length, item.name);
        const width = Math.round(item.dimensions.width * settings.scale);
        const height = Math.round(item.dimensions.height * settings.scale);
        const encoder = await createEncoder(settings.format, {
            width,
            height,
            fps: settings.fps,
            loop: settings.loop,
        });
        const blob = await captureToEncoder(item.element, encoder, {
            mode: 'now',
            durationMs: settings.durationMs,
            fps: settings.fps,
            scale: settings.scale,
            signal,
        });
        const buf = new Uint8Array(await blob.arrayBuffer());
        const safe = (item.name || 'artboard').replace(/[\\/:*?"<>|]/g, '_');
        entries[`${safe}.${settings.format}`] = buf;
    }
    const zipBytes = zipSync(entries);
    triggerDownload(new Blob([zipBytes], { type: 'application/zip' }), filename);
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
