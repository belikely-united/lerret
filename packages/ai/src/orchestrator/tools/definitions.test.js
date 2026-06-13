import { describe, it, expect } from 'vitest';

import {
    LIST_DIR_TOOL,
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    DELETE_FILE_TOOL,
    READ_TOOLS,
    ALL_TOOLS,
    LIST_DIR_MAX_ENTRIES,
    READ_FILE_CHAR_CAP,
    formatListing,
    capFileContent,
} from './definitions.js';

const FOUR_TOOLS = [LIST_DIR_TOOL, READ_FILE_TOOL, WRITE_FILE_TOOL, DELETE_FILE_TOOL];

describe('the four tool definitions', () => {
    it('carry the canonical names', () => {
        expect(FOUR_TOOLS.map((t) => t.name)).toEqual([
            'list_dir',
            'read_file',
            'write_file',
            'delete_file',
        ]);
    });

    it('every def is {name, description, parameters} with a JSON-Schema object', () => {
        for (const def of FOUR_TOOLS) {
            expect(typeof def.name).toBe('string');
            expect(typeof def.description).toBe('string');
            expect(def.description.length).toBeGreaterThan(20);
            expect(def.parameters).toMatchObject({ type: 'object' });
            expect(def.parameters.required).toContain('path');
        }
    });

    it('every path parameter uses the ONE project-relative description (identity at the seam)', () => {
        for (const def of FOUR_TOOLS) {
            const path = def.parameters.properties.path;
            expect(path.type).toBe('string');
            expect(path.description).toContain('project-relative path under .lerret/');
            expect(path.description).toContain('social/card.jsx');
            expect(path.description).toContain('.lerret/social/card.jsx');
        }
    });

    it('descriptions are prescriptive, not merely descriptive', () => {
        // list_dir: tells the model where to START.
        expect(LIST_DIR_TOOL.description).toContain("Start at '.lerret/'");
        expect(LIST_DIR_TOOL.description).toContain('immediate children');
        // read_file: read-before-write discipline.
        expect(READ_FILE_TOOL.description).toContain('ALWAYS call this before write_file');
        // write_file: whole-file semantics, parents auto-created, no partials.
        expect(WRITE_FILE_TOOL.description).toContain('COMPLETE');
        expect(WRITE_FILE_TOOL.description).toContain('parent folders automatically');
        expect(WRITE_FILE_TOOL.description).toContain('Never write partial content');
        // delete_file: cautious.
        expect(DELETE_FILE_TOOL.description).toContain('ONLY');
        expect(DELETE_FILE_TOOL.description).toContain('write_file');
    });

    it('write_file additionally requires the complete content string', () => {
        expect(WRITE_FILE_TOOL.parameters.properties.content).toMatchObject({ type: 'string' });
        expect(WRITE_FILE_TOOL.parameters.required).toEqual(['path', 'content']);
    });

    it('defs are deeply frozen — translators cannot reshape the contract', () => {
        for (const def of FOUR_TOOLS) {
            expect(Object.isFrozen(def)).toBe(true);
            expect(Object.isFrozen(def.parameters)).toBe(true);
            expect(Object.isFrozen(def.parameters.properties)).toBe(true);
            expect(Object.isFrozen(def.parameters.properties.path)).toBe(true);
        }
    });
});

describe('READ_TOOLS / ALL_TOOLS subsets', () => {
    it('READ_TOOLS is exactly [list_dir, read_file] — the Inspect lane surface', () => {
        expect(READ_TOOLS).toHaveLength(2);
        expect(READ_TOOLS[0]).toBe(LIST_DIR_TOOL);
        expect(READ_TOOLS[1]).toBe(READ_FILE_TOOL);
        expect(Object.isFrozen(READ_TOOLS)).toBe(true);
    });

    it('READ_TOOLS structurally contains no mutating tool — and no ask_user (Inspect never pauses)', () => {
        const names = READ_TOOLS.map((t) => t.name);
        expect(names).not.toContain('write_file');
        expect(names).not.toContain('delete_file');
        expect(names).not.toContain('ask_user');
    });

    it('ALL_TOOLS is the four file tools plus ask_user, in order, frozen', () => {
        expect(ALL_TOOLS.map((t) => t.name)).toEqual([
            'list_dir',
            'read_file',
            'write_file',
            'delete_file',
            'ask_user',
        ]);
        expect(Object.isFrozen(ALL_TOOLS)).toBe(true);
    });

    it('ask_user requires a question, allows optional options, and discourages over-asking', () => {
        const ask = ALL_TOOLS.find((t) => t.name === 'ask_user');
        expect(ask.parameters.required).toEqual(['question']);
        expect(ask.parameters.properties.options.type).toBe('array');
        expect(ask.description).toMatch(/ONLY at a genuine fork/);
        expect(ask.description).toMatch(/brand\/design conflict/);
    });
});

describe('output caps', () => {
    it('pins the architecture §3 values', () => {
        expect(LIST_DIR_MAX_ENTRIES).toBe(200);
        expect(READ_FILE_CHAR_CAP).toBe(12000);
    });
});

describe('formatListing', () => {
    it('formats entries as `name · kind · size B`, dirs without a size segment', () => {
        const out = formatListing([
            { name: 'card.jsx', kind: 'file', size: 1284 },
            { name: 'social', kind: 'dir' },
        ]);
        expect(out).toBe('card.jsx · file · 1284 B\nsocial · dir');
    });

    it('sorts entries by name', () => {
        const out = formatListing([
            { name: 'zebra.jsx', kind: 'file', size: 1 },
            { name: 'apple.jsx', kind: 'file', size: 2 },
        ]);
        expect(out.split('\n')[0]).toContain('apple.jsx');
        expect(out.split('\n')[1]).toContain('zebra.jsx');
    });

    it('caps at 200 entries WITH the narrowing guidance line', () => {
        const entries = Array.from({ length: 250 }, (_, i) => ({
            name: `f${String(i).padStart(4, '0')}.jsx`,
            kind: 'file',
            size: i,
        }));
        const lines = formatListing(entries).split('\n');
        expect(lines).toHaveLength(LIST_DIR_MAX_ENTRIES + 1);
        expect(lines.at(-1)).toBe('…[200 of 250 entries shown — list a subfolder to narrow]');
        expect(lines[0]).toContain('f0000.jsx');
        expect(lines[199]).toContain('f0199.jsx');
    });

    it('exactly at the cap → no guidance line', () => {
        const entries = Array.from({ length: LIST_DIR_MAX_ENTRIES }, (_, i) => ({
            name: `f${i}`,
            kind: 'file',
            size: 1,
        }));
        const lines = formatListing(entries).split('\n');
        expect(lines).toHaveLength(LIST_DIR_MAX_ENTRIES);
        expect(lines.at(-1)).not.toContain('entries shown');
    });

    it('empty or non-array input → a model-readable empty marker, never ""', () => {
        expect(formatListing([])).toBe('(empty folder)');
        expect(formatListing(undefined)).toBe('(empty folder)');
    });
});

describe('capFileContent', () => {
    it('passes content under the cap through untouched', () => {
        const content = 'export default function Card() {}';
        expect(capFileContent(content)).toBe(content);
    });

    it('exactly at the cap → untouched', () => {
        const content = 'x'.repeat(READ_FILE_CHAR_CAP);
        expect(capFileContent(content)).toBe(content);
    });

    it('over the cap → first 12000 chars plus the continuation guidance line', () => {
        const content = 'a'.repeat(READ_FILE_CHAR_CAP) + 'OVERFLOW';
        const out = capFileContent(content);
        expect(out.startsWith('a'.repeat(READ_FILE_CHAR_CAP))).toBe(true);
        expect(out).not.toContain('OVERFLOW');
        expect(out.endsWith('\n…[truncated at 12000 chars — the file continues]')).toBe(true);
    });

    it('coerces non-string input defensively', () => {
        expect(capFileContent(null)).toBe('');
        expect(capFileContent(undefined)).toBe('');
        expect(capFileContent(42)).toBe('42');
    });
});
