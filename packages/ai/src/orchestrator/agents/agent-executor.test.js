// Tests for the Agent Executor node (Epic 9, Story 9.3).
//
// The loop itself is unit-tested in ../tools/loop.test.js — here we pin the
// NODE's wiring: branch selection (W2/W3 → deterministic, tool-incapable →
// planner fallback, else loop), executor behavior against the Worker (the
// single-mutator inheritance), path canonicalization at the seam, and the
// prompt-sync invariant with the Epic 8 planner.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tools/loop.js', () => ({
    runAgentLoop: vi.fn(),
}));
vi.mock('../../providers/tool-support.js', () => ({
    supportsTools: vi.fn(() => true),
}));

import { runAgentLoop } from '../tools/loop.js';
import { supportsTools } from '../../providers/tool-support.js';
import { ALL_TOOLS } from '../tools/definitions.js';
import {
    createAgentExecutorNode,
    buildExecutors,
    buildLoopSystemPrompt,
    collectTreeForRemoval,
    isProtectedDirTarget,
} from './agent-executor.js';
import { createPlannerNode } from './planner.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSandbox(files = {}) {
    return {
        exists: vi.fn(async (p) => Object.prototype.hasOwnProperty.call(files, p)),
        readFile: vi.fn(async (p) => {
            if (!Object.prototype.hasOwnProperty.call(files, p)) {
                const err = new Error(`ENOENT: ${p}`);
                err.code = 'ENOENT';
                throw err;
            }
            return files[p];
        }),
        writeFile: vi.fn(async (p, c) => {
            files[p] = c;
        }),
        deleteFile: vi.fn(async (p) => {
            if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error(`ENOENT: ${p}`);
            delete files[p];
        }),
        mkdir: vi.fn(async () => {}),
        removeDir: vi.fn(async () => {}),
        listDir: vi.fn(async () => []),
    };
}

const snapshotStub = {
    isAlreadyCapturedInTurn: () => true,
    captureBeforeImage: vi.fn(async ({ manifest }) => manifest),
    capturePostImage: vi.fn(async () => ({ sha256: 'x' })),
    updateFileEntry: (m) => m,
};

function makeHandle({ tools = true, completeContent = '{"steps":[]}' } = {}) {
    return {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        modelSupportsVision: () => tools,
        complete: vi.fn(async () => ({ content: completeContent })),
        completeWithTools: vi.fn(),
    };
}

function makeNode(overrides = {}) {
    const sandbox = overrides.sandbox ?? makeSandbox();
    const emit = overrides.emit ?? vi.fn();
    const providerHandle = overrides.providerHandle ?? makeHandle();
    const node = createAgentExecutorNode({
        providerHandle,
        emit,
        requestVisionDecision: overrides.requestVisionDecision ?? vi.fn(),
        onContinueDecision: overrides.onContinueDecision,
        sandbox,
        fs: {},
        projectRoot: '/proj',
        snapshot: snapshotStub,
    });
    return { node, sandbox, emit, providerHandle };
}

beforeEach(() => {
    vi.clearAllMocks();
    supportsTools.mockReturnValue(true);
});

// ── buildLoopSystemPrompt ─────────────────────────────────────────────────────

describe('buildLoopSystemPrompt', () => {
    it('carries the load-bearing Epic 8 fragments + the tool guidance', () => {
        const sys = buildLoopSystemPrompt({ prompt: 'p', brandTokens: { brand: '#111' }, context: 'CTX' });
        expect(sys).toContain('export const meta = { dimensions');
        expect(sys).toContain('inline style objects only');
        expect(sys).toMatch(/ONLY when no asset is\s+selected/);
        expect(sys).toContain('list_dir(".lerret/")');
        expect(sys).toMatch(/read_file before rewriting an existing file/);
        expect(sys).toContain('CTX');
        expect(sys).toContain('"brand":"#111"');
    });

    it('adds the current-page default-location block ONLY when nothing else locates the work', () => {
        // Truly-unscoped: the block fires and names the page folder.
        const unscoped = buildLoopSystemPrompt({ prompt: 'create a linkedin banner', currentPage: '/abs/.lerret/kit' });
        expect(unscoped).toMatch(/currently viewing the kit page \(\.lerret\/kit\/\)/);
        expect(unscoped).toMatch(/CREATE NEW assets and the request does not name or clearly imply/);

        // A selected asset (scopedFile) wins — no current-page nudge (you're editing, not creating).
        const scoped = buildLoopSystemPrompt(
            { prompt: 'recolor this', currentPage: '/abs/.lerret/kit', scope: { kind: 'file', filePath: 'social/a.jsx' } },
            { path: '.lerret/social/a.jsx', content: 'X' },
        );
        expect(scoped).not.toMatch(/currently viewing/);

        // A page/artboards scope label already locates the work — no double signal.
        const pageScoped = buildLoopSystemPrompt({ prompt: 'p', currentPage: '/abs/.lerret/kit', scope: { kind: 'page', label: 'kit page' } });
        expect(pageScoped).not.toMatch(/currently viewing/);

        // No currentPage → no block at all.
        expect(buildLoopSystemPrompt({ prompt: 'p' })).not.toMatch(/currently viewing/);
    });

    it('folds the selected asset with precedence + pinpoint; page scope gets the label line', () => {
        const scoped = { path: '.lerret/kit/a.jsx', content: 'CONTENT' };
        const sys = buildLoopSystemPrompt(
            {
                scope: { kind: 'file', filePath: 'kit/a.jsx', element: { text: '$79', tag: 'span' } },
            },
            scoped,
        );
        expect(sys).toMatch(/selection takes precedence over every project-wide rule/);
        expect(sys).toContain('--- .lerret/kit/a.jsx (current content) ---');
        expect(sys).toContain('<span> element containing "$79"');

        const pageSys = buildLoopSystemPrompt({ scope: { kind: 'page', label: 'kit page' } });
        expect(pageSys).toMatch(/scoped this request to: kit page/);
    });

    it('stays in sync with the planner fallback prompt (shared invariants cannot drift)', async () => {
        const handle = makeHandle();
        await createPlannerNode({ providerHandle: handle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'make a card',
        });
        const plannerSys = handle.complete.mock.calls[0][0].messages[0].content;
        const loopSys = buildLoopSystemPrompt({ prompt: 'make a card' });
        for (const fragment of [
            'export const meta = { dimensions',
            'inline style objects only',
            '_design-system.md',
            'Never write .html files',
        ]) {
            expect(plannerSys).toContain(fragment);
            expect(loopSys).toContain(fragment);
        }
    });
});

// ── buildExecutors ────────────────────────────────────────────────────────────

describe('buildExecutors — Worker-backed mutations, sandbox reads', () => {
    function makeExecEnv(files = {}) {
        const sandbox = makeSandbox(files);
        const workerNode = vi.fn(async ({ manifest, plan }) => ({
            manifest,
            writtenFiles: plan
                .filter((s) => s.op === 'write' || s.op === 'delete')
                .map((s) => ({ path: s.path, op: s.op === 'delete' ? 'delete' : 'create' })),
        }));
        const manifestRef = { current: { id: 'm1' } };
        const writtenFiles = [];
        const executors = buildExecutors({ sandbox, workerNode, manifestRef, writtenFiles, signal: undefined });
        return { sandbox, workerNode, manifestRef, writtenFiles, executors };
    }

    it('write_file canonicalizes paths (relative / prefixed / absolute) and runs a mkdir+write Worker plan', async () => {
        const { executors, workerNode, writtenFiles } = makeExecEnv();
        for (const shape of ['kit/a.jsx', '.lerret/kit/a.jsx', '/abs/p/.lerret/kit/a.jsx']) {
            const res = await executors.write_file({ path: shape, content: 'X' });
            expect(res.isError).toBeUndefined();
        }
        for (const call of workerNode.mock.calls) {
            expect(call[0].plan).toEqual([
                { op: 'mkdir', path: '.lerret/kit' },
                { op: 'write', path: '.lerret/kit/a.jsx', content: 'X' },
            ]);
        }
        expect(writtenFiles).toHaveLength(3);
    });

    it('write_file at the .lerret root skips the mkdir step; non-string content is an isError without touching the Worker', async () => {
        const { executors, workerNode } = makeExecEnv();
        await executors.write_file({ path: 'a.jsx', content: 'X' });
        expect(workerNode.mock.calls[0][0].plan).toEqual([
            { op: 'write', path: '.lerret/a.jsx', content: 'X' },
        ]);
        const bad = await executors.write_file({ path: 'b.jsx', content: 42 });
        expect(bad.isError).toBe(true);
        expect(workerNode).toHaveBeenCalledTimes(1);
    });

    it('read_file caps content and reports ENOENT as isError; list_dir formats entries with meta', async () => {
        const { executors, sandbox } = makeExecEnv({ '.lerret/kit/a.jsx': 'BODY' });
        const ok = await executors.read_file({ path: 'kit/a.jsx' });
        expect(ok.content).toContain('BODY');
        expect(ok.meta).toEqual({ op: 'read', file: '.lerret/kit/a.jsx' });
        const missing = await executors.read_file({ path: 'kit/ghost.jsx' });
        expect(missing.isError).toBe(true);
        sandbox.listDir.mockResolvedValue([{ name: 'a.jsx', kind: 'file', size: 4 }]);
        const listing = await executors.list_dir({});
        expect(listing.meta).toEqual({ op: 'list', file: '.lerret/' });
        expect(listing.content).toContain('a.jsx');
    });

    it('ask_user awaits onClarify, bounds per turn, and never hangs headless', async () => {
        const onClarify = vi.fn(async ({ question, options }) => {
            expect(question).toBe('Green fights your brand blue — which way?');
            expect(options).toEqual(['Use green', 'Keep blue']);
            return 'Use green';
        });
        const withClarify = buildExecutors({
            sandbox: makeSandbox(),
            workerNode: vi.fn(),
            manifestRef: { current: {} },
            writtenFiles: [],
            signal: undefined,
            onClarify,
            maxQuestions: 2,
        });
        const ok = await withClarify.ask_user({
            question: 'Green fights your brand blue — which way?',
            options: ['Use green', 'Keep blue'],
        });
        expect(onClarify).toHaveBeenCalledTimes(1);
        expect(ok.content).toBe('The user answered: Use green');
        expect(ok.meta).toEqual({ op: 'ask' });

        // Second question allowed (budget 2); third is hard-stopped without
        // calling onClarify — no interrogation loop.
        await withClarify.ask_user({ question: 'q2' });
        const blocked = await withClarify.ask_user({ question: 'q3' });
        expect(onClarify).toHaveBeenCalledTimes(2);
        expect(blocked.content).toMatch(/already asked enough questions/);

        // Empty question → isError; headless (no onClarify) → safe default, no hang.
        const empty = await withClarify.ask_user({ question: '   ' });
        expect(empty.isError).toBe(true);
        const headless = buildExecutors({
            sandbox: makeSandbox(),
            workerNode: vi.fn(),
            manifestRef: { current: {} },
            writtenFiles: [],
            signal: undefined,
        });
        const def = await headless.ask_user({ question: 'anything?' });
        expect(def.isError).toBeUndefined();
        expect(def.content).toMatch(/No user is available/);
    });

    it('delete_file failures surface as isError results, never throws', async () => {
        const { executors } = makeExecEnv();
        const res = await executors.delete_file({ path: 'kit/ghost.jsx' });
        expect(res.isError).toBeUndefined(); // workerNode stub deletes blind — now force a throw:
        const throwing = buildExecutors({
            sandbox: makeSandbox(),
            workerNode: vi.fn(async () => {
                throw new Error('boom');
            }),
            manifestRef: { current: {} },
            writtenFiles: [],
            signal: undefined,
        });
        const failed = await throwing.delete_file({ path: 'kit/a.jsx' });
        expect(failed.isError).toBe(true);
        expect(failed.content).toContain('boom');
    });

    // ── delete_dir — recursive page removal through the snapshotted path ─────────

    it('delete_dir recursively deletes files first, then rmdirs bottom-up; summary counts files', async () => {
        // A page with a nested subfolder: social/ has b.jsx + sub/a.jsx.
        const sandbox = makeSandbox({
            '.lerret/social': true, // exists() probe
            '.lerret/social/b.jsx': 'B',
            '.lerret/social/sub/a.jsx': 'A',
        });
        // listDir drives the tree walk: root → [b.jsx, sub]; sub → [a.jsx].
        sandbox.listDir = vi.fn(async (p) => {
            if (p === '.lerret/social') {
                return [
                    { name: 'b.jsx', kind: 'file' },
                    { name: 'sub', kind: 'dir' },
                ];
            }
            if (p === '.lerret/social/sub') return [{ name: 'a.jsx', kind: 'file' }];
            return [];
        });
        const workerNode = vi.fn(async ({ manifest, plan }) => ({
            manifest,
            writtenFiles: plan
                .filter((s) => s.op === 'delete')
                .map((s) => ({ path: s.path, op: 'delete' })),
        }));
        const writtenFiles = [];
        const executors = buildExecutors({
            sandbox,
            workerNode,
            manifestRef: { current: { id: 'm1' } },
            writtenFiles,
            signal: undefined,
        });

        const res = await executors.delete_dir({ path: 'social' });
        expect(res.isError).toBeUndefined();
        // ONE worker plan: both file deletes FIRST, then rmdirs deepest-first
        // ending at the page root.
        expect(workerNode).toHaveBeenCalledTimes(1);
        const plan = workerNode.mock.calls[0][0].plan;
        const deletes = plan.filter((s) => s.op === 'delete').map((s) => s.path);
        const rmdirs = plan.filter((s) => s.op === 'rmdir').map((s) => s.path);
        expect(new Set(deletes)).toEqual(
            new Set(['.lerret/social/b.jsx', '.lerret/social/sub/a.jsx']),
        );
        // Every delete precedes every rmdir.
        const firstRmdirIdx = plan.findIndex((s) => s.op === 'rmdir');
        expect(plan.slice(0, firstRmdirIdx).every((s) => s.op === 'delete')).toBe(true);
        // rmdirs bottom-up: the deepest dir before its parent; root removed last.
        expect(rmdirs).toEqual(['.lerret/social/sub', '.lerret/social']);
        // Summary counts the FILES (+ the folder); writtenFiles got the deletes.
        expect(res.content).toBe('Removed .lerret/social (2 files + the folder).');
        expect(writtenFiles).toHaveLength(2);
    });

    it('delete_dir on an empty page removes just the folder (0 files)', async () => {
        const sandbox = makeSandbox({ '.lerret/empty': true });
        sandbox.listDir = vi.fn(async () => []);
        const workerNode = vi.fn(async ({ manifest, plan }) => ({
            manifest,
            writtenFiles: plan.filter((s) => s.op === 'delete').map((s) => ({ path: s.path, op: 'delete' })),
        }));
        const executors = buildExecutors({
            sandbox,
            workerNode,
            manifestRef: { current: {} },
            writtenFiles: [],
            signal: undefined,
        });
        const res = await executors.delete_dir({ path: 'empty' });
        // No "turn stopping" false-positive: the plan is just one rmdir, which
        // produces zero writtenFiles legitimately.
        expect(res.isError).toBeUndefined();
        expect(res.content).toBe('Removed .lerret/empty (0 files + the folder).');
        expect(workerNode.mock.calls[0][0].plan).toEqual([{ op: 'rmdir', path: '.lerret/empty' }]);
    });

    it('delete_dir rejects the .lerret/ root, a missing folder, and protected targets', async () => {
        const sandbox = makeSandbox({}); // nothing exists
        const workerNode = vi.fn();
        const executors = buildExecutors({
            sandbox,
            workerNode,
            manifestRef: { current: {} },
            writtenFiles: [],
            signal: undefined,
        });
        // Root.
        const root = await executors.delete_dir({ path: '.lerret/' });
        expect(root.isError).toBe(true);
        // Protected files + the snapshot sidecar — refused BEFORE any fs touch.
        for (const p of ['_design-system.md', '_context.md', 'config.json', '.state', '.state/history']) {
            const out = await executors.delete_dir({ path: p });
            expect(out.isError, p).toBe(true);
            expect(out.content, p).toMatch(/protected project file or the snapshot store/);
        }
        // Missing folder → clear isError, never a silent success.
        const missing = await executors.delete_dir({ path: 'ghost-page' });
        expect(missing.isError).toBe(true);
        expect(missing.content).toMatch(/No such page\/folder/);
        // None of the rejections reached the Worker.
        expect(workerNode).not.toHaveBeenCalled();
    });

    it('delete_dir surfaces a Worker throw as isError, never throws', async () => {
        const sandbox = makeSandbox({ '.lerret/social': true });
        sandbox.listDir = vi.fn(async () => []);
        const executors = buildExecutors({
            sandbox,
            workerNode: vi.fn(async () => {
                throw new Error('kaboom');
            }),
            manifestRef: { current: {} },
            writtenFiles: [],
            signal: undefined,
        });
        const failed = await executors.delete_dir({ path: 'social' });
        expect(failed.isError).toBe(true);
        expect(failed.content).toContain('kaboom');
    });
});

// ── delete_dir helpers (pure) ───────────────────────────────────────────────────

describe('collectTreeForRemoval', () => {
    it('returns files in discovery order and dirs deepest-first ending at the root', async () => {
        const tree = {
            '.lerret/p': [
                { name: 'top.jsx', kind: 'file' },
                { name: 'a', kind: 'dir' },
            ],
            '.lerret/p/a': [
                { name: 'mid.jsx', kind: 'file' },
                { name: 'deep', kind: 'dir' },
            ],
            '.lerret/p/a/deep': [{ name: 'leaf.jsx', kind: 'file' }],
        };
        const sandbox = { listDir: vi.fn(async (p) => tree[p] ?? []) };
        const { files, dirs } = await collectTreeForRemoval(sandbox, '.lerret/p');
        expect(new Set(files)).toEqual(
            new Set(['.lerret/p/top.jsx', '.lerret/p/a/mid.jsx', '.lerret/p/a/deep/leaf.jsx']),
        );
        // Deepest dir first; root last — so each rmdir hits an empty directory.
        expect(dirs[dirs.length - 1]).toBe('.lerret/p');
        expect(dirs.indexOf('.lerret/p/a/deep')).toBeLessThan(dirs.indexOf('.lerret/p/a'));
        expect(dirs.indexOf('.lerret/p/a')).toBeLessThan(dirs.indexOf('.lerret/p'));
    });
});

describe('isProtectedDirTarget', () => {
    it('flags the protected project files and the whole .state sidecar', () => {
        expect(isProtectedDirTarget('.lerret/_design-system.md')).toBe(true);
        expect(isProtectedDirTarget('.lerret/_context.md')).toBe(true);
        expect(isProtectedDirTarget('.lerret/config.json')).toBe(true);
        expect(isProtectedDirTarget('.lerret/.state')).toBe(true);
        expect(isProtectedDirTarget('.lerret/.state/history/manifests')).toBe(true);
    });

    it('does NOT flag a normal page/folder', () => {
        expect(isProtectedDirTarget('.lerret/social')).toBe(false);
        expect(isProtectedDirTarget('.lerret/kit/sub')).toBe(false);
        // A page whose name merely starts with `.state` but is not the sidecar.
        expect(isProtectedDirTarget('.lerret/.stately')).toBe(false);
    });
});

// ── Node branches ─────────────────────────────────────────────────────────────

describe('createAgentExecutorNode — branch selection', () => {
    it('W2 launch-kit runs deterministically through the Worker — zero provider calls', async () => {
        const { node, providerHandle } = makeNode();
        const out = await node({
            prompt: 'launch kit for twitter',
            scope: { kind: 'project' },
            brandTokens: {},
            manifest: { id: 'm' },
        });
        expect(providerHandle.completeWithTools).not.toHaveBeenCalled();
        expect(providerHandle.complete).not.toHaveBeenCalled();
        expect(runAgentLoop).not.toHaveBeenCalled();
        expect(out.writtenFiles.length).toBeGreaterThan(0);
    });

    it('tool-incapable model degrades to the planner fallback with a clarifying note (FR64)', async () => {
        supportsTools.mockReturnValue(false);
        const providerHandle = makeHandle({
            completeContent: JSON.stringify({
                steps: [{ op: 'write', path: '.lerret/kit/x.jsx', content: 'X' }],
            }),
        });
        const { node, emit } = makeNode({ providerHandle });
        const out = await node({ prompt: 'make a card', scope: {}, manifest: { id: 'm' } });
        expect(runAgentLoop).not.toHaveBeenCalled();
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
        const notes = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === 'clarifying-note');
        expect(notes.some((n) => /doesn't support tool use/.test(n.note))).toBe(true);
        expect(out.writtenFiles).toEqual([{ path: '.lerret/kit/x.jsx', op: 'create' }]);
    });

    it('tool-capable models run the loop with ALL_TOOLS; the loop summary becomes the answer', async () => {
        runAgentLoop.mockResolvedValue({
            status: 'done',
            text: 'Created the banner.',
            usage: { inputTokens: 10, outputTokens: 5, calls: 2 },
            steps: [],
        });
        const { node } = makeNode();
        const out = await node({ prompt: 'make a banner', scope: {}, manifest: { id: 'm' } });
        expect(runAgentLoop).toHaveBeenCalledTimes(1);
        const args = runAgentLoop.mock.calls[0][0];
        expect(args.tools).toBe(ALL_TOOLS);
        expect(args.messages[0].role).toBe('system');
        expect(args.messages[1]).toEqual({ role: 'user', content: 'make a banner' });
        expect(out.answer).toBe('Created the banner.');
    });

    it('a cap-stop without text gets the fixed summary; pre-aborted turns do nothing', async () => {
        runAgentLoop.mockResolvedValue({ status: 'cap-stopped', text: '', usage: {}, steps: [] });
        const { node } = makeNode();
        const out = await node({ prompt: 'p', scope: {}, manifest: {} });
        expect(out.answer).toBe('Stopped at the step cap.');

        const aborted = new AbortController();
        aborted.abort();
        const { node: node2, providerHandle } = makeNode();
        const out2 = await node2({ prompt: 'p', scope: {}, manifest: {}, signal: aborted.signal });
        expect(out2.writtenFiles).toEqual([]);
        expect(providerHandle.completeWithTools).not.toHaveBeenCalled();
        expect(runAgentLoop).toHaveBeenCalledTimes(1); // only the first test's call
    });

    it('the selection chip file is folded into the loop messages (scoped context, no read round-trip)', async () => {
        runAgentLoop.mockResolvedValue({ status: 'done', text: 'ok', usage: {}, steps: [] });
        const sandbox = makeSandbox({ '.lerret/kit/a.jsx': 'SCOPED-CONTENT' });
        const { node } = makeNode({ sandbox });
        await node({
            prompt: 'recolor this',
            scope: { kind: 'file', filePath: 'kit/a.jsx' },
            manifest: {},
        });
        const sys = runAgentLoop.mock.calls[0][0].messages[0].content;
        expect(sys).toContain('SCOPED-CONTENT');
        expect(sys).toMatch(/selection takes precedence/);
    });
});
