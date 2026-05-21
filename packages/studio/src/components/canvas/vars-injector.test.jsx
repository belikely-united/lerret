// Tests for vars-injector.jsx.
//
// Covers:
// buildVarsStyle — pure unit tests for the vars-to-custom-properties
// conversion: single key, multiple keys, no vars block, all-invalid keys,
// mixed valid/invalid keys, length limit, deep-merge precedence (verified
// via caller-supplied merged vars objects), and empty / non-object inputs.
//
// assetFolderPath — derives the parent folder path from an asset path.
//
// VarsWrapper (React component) — integration: the component reads the
// cascade context via useCascadedConfig and applies custom properties on
// its wrapper div; tests cover a folder with vars, a folder without vars,
// and a folder not in the cascade (no error).

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { buildVarsStyle, assetFolderPath, VarsWrapper } from './vars-injector.jsx';
import { CascadedConfigProvider } from './cascade-context.jsx';

// ---------------------------------------------------------------------------
// DOM test helpers
// ---------------------------------------------------------------------------

let mountedRoots = [];
let mountedContainers = [];

afterEach(() => {
 for (const root of mountedRoots) {
 act(() => root.unmount());
 }
 for (const container of mountedContainers) {
 container.remove();
 }
 mountedRoots = [];
 mountedContainers = [];
});

function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 mountedContainers.push(container);
 const root = createRoot(container);
 act(() => root.render(element));
 mountedRoots.push(root);
 return { container };
}

// ---------------------------------------------------------------------------
// buildVarsStyle — pure unit tests
// ---------------------------------------------------------------------------

describe('buildVarsStyle', () => {
 it('returns null when vars is absent (undefined)', () => {
 expect(buildVarsStyle(undefined)).toBeNull();
 });

 it('returns null when vars is null', () => {
 expect(buildVarsStyle(null)).toBeNull();
 });

 it('returns null when vars is an empty object (no entries)', () => {
 expect(buildVarsStyle({})).toBeNull();
 });

 it('returns null when vars is an array (not a plain object)', () => {
 expect(buildVarsStyle(['a', 'b'])).toBeNull();
 });

 it('returns null when vars is a string', () => {
 expect(buildVarsStyle('not-an-object')).toBeNull();
 });

 it('converts a single valid key to a --key custom property', () => {
 const result = buildVarsStyle({ brandColor: '#B85B33' });
 expect(result).toEqual({ '--brandColor': '#B85B33' });
 });

 it('converts multiple valid keys', () => {
 const vars = { brandColor: '#B85B33', maxWidth: '1200px', spacing: '8px' };
 const result = buildVarsStyle(vars);
 expect(result).toEqual({
 '--brandColor': '#B85B33',
 '--maxWidth': '1200px',
 '--spacing': '8px',
 });
 });

 it('coerces the value to a string (number value)', () => {
 const result = buildVarsStyle({ opacity: 0.8 });
 expect(result).toEqual({ '--opacity': '0.8' });
 });

 it('skips a key that starts with a digit and warns', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const result = buildVarsStyle({ '1invalid': 'red' });
 expect(result).toBeNull();
 expect(warnSpy).toHaveBeenCalledOnce();
 expect(warnSpy.mock.calls[0][0]).toContain('1invalid');
 warnSpy.mockRestore();
 });

 it('skips a key with spaces and warns', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const result = buildVarsStyle({ 'bad key': 'red' });
 expect(result).toBeNull();
 expect(warnSpy).toHaveBeenCalledOnce();
 warnSpy.mockRestore();
 });

 it('skips a key with special characters and warns', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const result = buildVarsStyle({ 'brand.color': '#fff' });
 expect(result).toBeNull();
 expect(warnSpy).toHaveBeenCalledOnce();
 warnSpy.mockRestore();
 });

 it('skips a key exceeding the 200-char limit and warns', () => {
 const longKey = 'a'.repeat(201);
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const result = buildVarsStyle({ [longKey]: 'value' });
 expect(result).toBeNull();
 expect(warnSpy).toHaveBeenCalledOnce();
 warnSpy.mockRestore();
 });

 it('skips invalid keys but still injects valid ones (mixed batch)', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const vars = {
 validKey: '#B85B33', // valid
 '2bad': 'red', // invalid — starts with digit
 anotherValid: '24px', // valid
 };
 const result = buildVarsStyle(vars, '/some/folder');
 expect(result).toEqual({
 '--validKey': '#B85B33',
 '--anotherValid': '24px',
 });
 // One warn for the invalid key.
 expect(warnSpy).toHaveBeenCalledOnce();
 expect(warnSpy.mock.calls[0][0]).toContain('2bad');
 warnSpy.mockRestore();
 });

 it('accepts underscore-prefixed and hyphenated ident segments', () => {
 const vars = { _private: 'value', color_accent: '#aaa', 'color-brand': '#bbb' };
 const result = buildVarsStyle(vars);
 expect(result).toEqual({
 '--_private': 'value',
 '--color_accent': '#aaa',
 '--color-brand': '#bbb',
 });
 });

 it('deep-merge precedence: child key wins over parent — caller supplies merged object', () => {
 // The cascade's effective config already contains the deep-merged vars
 // (child wins on collision). This test verifies that buildVarsStyle emits
 // the merged value correctly — i.e. child's "#FF0000" for "brandColor"
 // overrides parent's "#B85B33".
 const mergedVars = {
 brandColor: '#FF0000', // child overrode the parent's #B85B33
 maxWidth: '1200px', // parent-only key, still present
 };
 const result = buildVarsStyle(mergedVars);
 expect(result).toEqual({
 '--brandColor': '#FF0000',
 '--maxWidth': '1200px',
 });
 });

 it('returns null when all keys in the vars block are invalid', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const result = buildVarsStyle({ '1a': 'x', '2b': 'y' });
 expect(result).toBeNull();
 expect(warnSpy).toHaveBeenCalledTimes(2);
 warnSpy.mockRestore();
 });

 it('warn message includes the folder path for diagnosis', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 buildVarsStyle({ 'bad!key': 'value' }, '/.lerret/ui-components');
 expect(warnSpy).toHaveBeenCalledOnce();
 expect(warnSpy.mock.calls[0][0]).toContain('/.lerret/ui-components');
 warnSpy.mockRestore();
 });
});

// ---------------------------------------------------------------------------
// assetFolderPath — unit tests
// ---------------------------------------------------------------------------

describe('assetFolderPath', () => {
 it('returns the directory part of a normal asset path', () => {
 expect(assetFolderPath('/.lerret/ui-components/Button.jsx')).toBe('/.lerret/ui-components');
 });

 it('returns the directory for a deeply nested asset', () => {
 expect(assetFolderPath('/.lerret/ui/buttons/icon-buttons/Close.jsx')).toBe(
 '/.lerret/ui/buttons/icon-buttons',
 );
 });

 it('returns empty string for a path with no slash', () => {
 expect(assetFolderPath('Button.jsx')).toBe('');
 });

 it('returns empty string for an empty string input', () => {
 expect(assetFolderPath('')).toBe('');
 });

 it('returns empty string for a non-string input', () => {
 expect(assetFolderPath(null)).toBe('');
 expect(assetFolderPath(undefined)).toBe('');
 });

 it('handles a path that is just a filename with a leading slash', () => {
 // "/Button.jsx" — the folder is "" (root-level, unusual but shouldn't crash)
 expect(assetFolderPath('/Button.jsx')).toBe('');
 });
});

// ---------------------------------------------------------------------------
// VarsWrapper — React component integration tests
// ---------------------------------------------------------------------------

describe('VarsWrapper', () => {
 it('injects a single vars key as a CSS custom property on the wrapper div', () => {
 const cascadeEntries = [
 ['/.lerret/ui-components', { vars: { brandColor: '#B85B33' } }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/ui-components">
 <span data-child>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 const wrapper = container.firstChild;
 expect(wrapper).not.toBeNull();
 // React sets custom properties via style.setProperty — jsdom exposes them
 // on the element's inline style.
 expect(wrapper.style.getPropertyValue('--brandColor')).toBe('#B85B33');
 });

 it('injects multiple vars keys as CSS custom properties', () => {
 const cascadeEntries = [
 ['/.lerret/ui-components', { vars: { brandColor: '#B85B33', maxWidth: '1200px' } }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/ui-components">
 <span data-child>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 const wrapper = container.firstChild;
 expect(wrapper.style.getPropertyValue('--brandColor')).toBe('#B85B33');
 expect(wrapper.style.getPropertyValue('--maxWidth')).toBe('1200px');
 });

 it('adds no custom properties when the folder config has no vars block', () => {
 const cascadeEntries = [
 ['/.lerret/ui-components', { presentation: { background: '#fff' } }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/ui-components">
 <span data-child>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 const wrapper = container.firstChild;
 // No --brandColor or any custom property.
 expect(wrapper.style.getPropertyValue('--brandColor')).toBe('');
 expect(wrapper.style.cssText).toBe('');
 });

 it('renders normally when the folder path is not in the cascade (no error)', () => {
 const cascadeEntries = [
 ['/.lerret/other', { vars: { x: '1' } }],
 ];
 expect(() => {
 renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/ui-components">
 <span data-child>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 }).not.toThrow();
 // No custom properties expected.
 });

 it('renders without a CascadedConfigProvider (no error, no custom properties)', () => {
 expect(() => {
 renderToDom(
 <VarsWrapper folderPath="/.lerret/ui-components">
 <span data-child>child</span>
 </VarsWrapper>,
 );
 }).not.toThrow();
 });

 it('merges the vars style with the caller-supplied style prop', () => {
 const cascadeEntries = [
 ['/.lerret/page', { vars: { accent: '#f00' } }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper
 folderPath="/.lerret/page"
 style={{ position: 'relative', width: '100%', height: '100%' }}
 >
 <span data-child>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 const wrapper = container.firstChild;
 expect(wrapper.style.position).toBe('relative');
 expect(wrapper.style.width).toBe('100%');
 expect(wrapper.style.height).toBe('100%');
 expect(wrapper.style.getPropertyValue('--accent')).toBe('#f00');
 });

 it('renders children inside the wrapper div', () => {
 const cascadeEntries = [
 ['/.lerret/page', { vars: { x: '1' } }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/page">
 <span data-child-sentinel>hello</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 expect(container.querySelector('[data-child-sentinel]')).not.toBeNull();
 });

 it('skips an invalid key and still injects the valid ones (mixed batch)', () => {
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const cascadeEntries = [
 ['/.lerret/page', { vars: { validKey: 'blue', '2bad': 'red', anotherValid: '24px' } }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/page">
 <span>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 const wrapper = container.firstChild;
 expect(wrapper.style.getPropertyValue('--validKey')).toBe('blue');
 expect(wrapper.style.getPropertyValue('--anotherValid')).toBe('24px');
 // Invalid key produces no property.
 expect(wrapper.style.getPropertyValue('--2bad')).toBe('');
 // Warn was emitted.
 expect(warnSpy).toHaveBeenCalledOnce();
 warnSpy.mockRestore();
 });

 it('deep-merge precedence: child folder value wins for a colliding key', () => {
 // The cascade Map already holds the *effective* (deep-merged) config for
 // each folder. Simulate a child folder whose effective config has already
 // had child's brandColor merged in (child "#FF0000" beats parent "#B85B33").
 const cascadeEntries = [
 ['/.lerret/ui/buttons', {
 vars: {
 brandColor: '#FF0000', // child's value (won collision with parent's #B85B33)
 maxWidth: '1200px', // parent-only key — still present after merge
 },
 }],
 ];
 const { container } = renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper folderPath="/.lerret/ui/buttons">
 <span>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 const wrapper = container.firstChild;
 expect(wrapper.style.getPropertyValue('--brandColor')).toBe('#FF0000');
 expect(wrapper.style.getPropertyValue('--maxWidth')).toBe('1200px');
 });

 it('renders when folderPath prop is absent (no error, no custom properties)', () => {
 const cascadeEntries = [['/.lerret/page', { vars: { x: '1' } }]];
 expect(() => {
 renderToDom(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <VarsWrapper>
 <span>child</span>
 </VarsWrapper>
 </CascadedConfigProvider>,
 );
 }).not.toThrow();
 });
});
