import { describe, it, expect } from 'vitest';

import {
    LIST_DIR_TOOL,
    READ_FILE_TOOL,
    SEARCH_TOOL,
    WRITE_FILE_TOOL,
    DELETE_FILE_TOOL,
    DELETE_DIR_TOOL,
    READ_TOOLS,
    ALL_TOOLS,
    LIST_DIR_MAX_ENTRIES,
    READ_FILE_CHAR_CAP,
    SEARCH_MAX_MATCHES,
    formatListing,
    capFileContent,
    formatSearch,
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

describe('DELETE_DIR_TOOL — page/folder removal (Epic 9 follow-up)', () => {
    it('is named delete_dir with one required `path` param using the shared description', () => {
        expect(DELETE_DIR_TOOL.name).toBe('delete_dir');
        expect(DELETE_DIR_TOOL.parameters).toMatchObject({ type: 'object' });
        expect(DELETE_DIR_TOOL.parameters.required).toEqual(['path']);
        expect(DELETE_DIR_TOOL.parameters.additionalProperties).toBe(false);
        const path = DELETE_DIR_TOOL.parameters.properties.path;
        expect(path.type).toBe('string');
        expect(path.description).toContain('project-relative path under .lerret/');
    });

    it('has a prescriptive description: removes a page + contents, explicit-intent only, distinct from delete_file', () => {
        const d = DELETE_DIR_TOOL.description;
        expect(d).toContain('Remove a page/folder and EVERYTHING inside it');
        expect(d).toContain('ONLY when the user explicitly asks');
        // The load-bearing distinction the killer-feature relies on.
        expect(d).toContain("Deleting a page's individual assets does NOT remove the page");
    });

    it('is deeply frozen — a translator cannot reshape it', () => {
        expect(Object.isFrozen(DELETE_DIR_TOOL)).toBe(true);
        expect(Object.isFrozen(DELETE_DIR_TOOL.parameters)).toBe(true);
        expect(Object.isFrozen(DELETE_DIR_TOOL.parameters.properties)).toBe(true);
    });
});

describe('READ_TOOLS / ALL_TOOLS subsets', () => {
    it('READ_TOOLS is exactly [list_dir, read_file, search] — the read-only Inspect lane surface', () => {
        expect(READ_TOOLS).toHaveLength(3);
        expect(READ_TOOLS[0]).toBe(LIST_DIR_TOOL);
        expect(READ_TOOLS[1]).toBe(READ_FILE_TOOL);
        expect(READ_TOOLS[2]).toBe(SEARCH_TOOL);
        expect(Object.isFrozen(READ_TOOLS)).toBe(true);
    });

    it('READ_TOOLS structurally contains no mutating tool — and no ask_user (Inspect never pauses)', () => {
        const names = READ_TOOLS.map((t) => t.name);
        expect(names).not.toContain('write_file');
        expect(names).not.toContain('delete_file');
        expect(names).not.toContain('delete_dir');
        expect(names).not.toContain('ask_user');
        // search is read-only, so it rides in the Inspect lane too.
        expect(names).toContain('search');
    });

    it('ALL_TOOLS is the file tools (incl. search + delete_dir) plus ask_user, in order, frozen', () => {
        expect(ALL_TOOLS.map((t) => t.name)).toEqual([
            'list_dir',
            'read_file',
            'search',
            'write_file',
            'save_attachment',
            'delete_file',
            'delete_dir',
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

describe('SEARCH_TOOL + formatSearch (inventory + verify surface)', () => {
    it('SEARCH_TOOL requires query, allows optional path scope, frozen, read-only-shaped', () => {
        expect(SEARCH_TOOL.name).toBe('search');
        expect(SEARCH_TOOL.parameters.required).toEqual(['query']);
        expect(SEARCH_TOOL.parameters.properties.query.type).toBe('string');
        expect(SEARCH_TOOL.parameters.properties.path).toBeTruthy();
        expect(SEARCH_TOOL.parameters.additionalProperties).toBe(false);
        expect(SEARCH_TOOL.description).toMatch(/before a project-wide change/i);
        expect(Object.isFrozen(SEARCH_TOOL)).toBe(true);
        expect(Object.isFrozen(SEARCH_TOOL.parameters)).toBe(true);
    });

    it('formatSearch renders grep-style path:line: text, "(no matches)" when empty', () => {
        expect(formatSearch([])).toBe('(no matches)');
        expect(formatSearch(null)).toBe('(no matches)');
        expect(
            formatSearch([{ path: '.lerret/a.jsx', line: 3, text: 'Glims.io' }]),
        ).toBe('.lerret/a.jsx:3: Glims.io');
    });

    it('formatSearch caps at SEARCH_MAX_MATCHES with a guidance line naming how to narrow', () => {
        const many = Array.from({ length: SEARCH_MAX_MATCHES + 5 }, (_, i) => ({
            path: `.lerret/f${i}.jsx`,
            line: 1,
            text: 'x',
        }));
        const lines = formatSearch(many).split('\n');
        expect(lines).toHaveLength(SEARCH_MAX_MATCHES + 1);
        expect(lines[lines.length - 1]).toContain(`${SEARCH_MAX_MATCHES} of ${SEARCH_MAX_MATCHES + 5}`);
        expect(lines[lines.length - 1]).toMatch(/narrow/i);
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
