// use-inline-rename.test.js — pure-helper tests for the rename path math
//.

import { describe, it, expect } from 'vitest';

import {
 renamedFilePath,
 renamedFolderPath,
 splitFilePath,
 splitFolderPath,
} from './use-inline-rename.js';

describe('splitFilePath', () => {
 it('extracts dir / stem / ext', () => {
 expect(splitFilePath('/a/b/Foo.jsx')).toEqual({ dir: '/a/b/', stem: 'Foo', ext: '.jsx' });
 });
 it('handles a no-extension file', () => {
 expect(splitFilePath('/a/b/Makefile')).toEqual({ dir: '/a/b/', stem: 'Makefile', ext: '' });
 });
 it('treats a leading-dot file as all-stem', () => {
 expect(splitFilePath('/a/b/.gitignore')).toEqual({ dir: '/a/b/', stem: '.gitignore', ext: '' });
 });
 it('handles a file at the root', () => {
 expect(splitFilePath('Foo.tsx')).toEqual({ dir: '', stem: 'Foo', ext: '.tsx' });
 });
});

describe('splitFolderPath', () => {
 it('splits into parentDir and name', () => {
 expect(splitFolderPath('/a/b/buttons')).toEqual({ parentDir: '/a/b/', name: 'buttons' });
 });
 it('tolerates a trailing slash', () => {
 expect(splitFolderPath('/a/b/buttons/')).toEqual({ parentDir: '/a/b/', name: 'buttons' });
 });
 it('handles a top-level folder', () => {
 expect(splitFolderPath('docs')).toEqual({ parentDir: '', name: 'docs' });
 });
});

describe('renamedFilePath', () => {
 it('returns the new path with the original extension preserved', () => {
 expect(renamedFilePath('/x/.lerret/Foo.jsx', 'Bar')).toBe('/x/.lerret/Bar.jsx');
 });
 it('returns null when the new stem is empty', () => {
 expect(renamedFilePath('/x/.lerret/Foo.jsx', '')).toBe(null);
 expect(renamedFilePath('/x/.lerret/Foo.jsx', ' ')).toBe(null);
 });
 it('returns null when the name is unchanged', () => {
 expect(renamedFilePath('/x/.lerret/Foo.jsx', 'Foo')).toBe(null);
 });
 it('collapses internal whitespace and trims', () => {
 expect(renamedFilePath('/x/.lerret/Foo.jsx', ' Hero Banner ')).toBe(
 '/x/.lerret/Hero Banner.jsx',
 );
 });
});

describe('renamedFolderPath', () => {
 it('returns the new folder path', () => {
 expect(renamedFolderPath('/x/.lerret/buttons', 'icons')).toBe('/x/.lerret/icons');
 });
 it('returns null when the new name is empty or unchanged', () => {
 expect(renamedFolderPath('/x/.lerret/buttons', '')).toBe(null);
 expect(renamedFolderPath('/x/.lerret/buttons', 'buttons')).toBe(null);
 });
});
