// Inspector agent — read-only project Q&A (FR58, Story 8.9).
//
// The Inspector answers questions about the project WITHOUT mutating anything.
// It calls the provider through the passed-in handle, combining:
//   1. the project context the Memory node already gathered (state.context),
//   2. TARGETED file reads — when the user's question references project files
//      by path (`explain ReleaseCard.jsx`, `what's in social/launch.jsx?`),
//      the node resolves those tokens against the sandbox's NON-mutating
//      surface (the read + existence checks only) and folds the file contents
//      into the provider prompt. Each successful read emits a `reading{file}`
//      TurnEvent so the dock pill shows Reading… (UX state model: Thinking →
//      Reading → Done — inspect mode has NO Writing transition).
//
// ── Structural read-only guarantee (FR58 / AC-10) ───────────────────────────
// This file NEVER imports `./worker.js` and never touches a write/delete/mkdir
// surface — the only sandbox members it reads are the non-mutating pair
// (readFile + exists). The graph's inspect branch routes Memory → Inspector →
// END, so the inspect path never REACHES the Worker node at runtime, and
// `inspect-no-worker.test.js` pins both facts structurally (a grep over this
// source + mutation spies over a full inspect turn).
//
// ── Answer contract (AC-6 / AC-9) ───────────────────────────────────────────
// A successful turn emits exactly ONE `inspector-response` TurnEvent carrying
// the finished, user-facing answer text (never raw agent internals — UX
// Anti-goal #3), then returns `{ answer }` into graph state. When the answer
// references a project file, the system prompt instructs the model to write
// the project-relative POSIX path VERBATIM (e.g. `.lerret/social/card.jsx`)
// so the studio thread card's link-detector can match it and focus the
// corresponding artboard — link RENDERING is a studio concern, not this
// agent's (core-purity: no DOM here).

import { thinking, reading, inspectorResponse } from '../events.js';

/**
 * File-path token extraction — LINEAR-TIME by construction. The prompt is
 * first split on every character OUTSIDE the path charset (`[\w@/.-]`), then
 * each segment is matched ONCE with a start-anchored pattern. The previous
 * single unanchored global regex (`/[\w@/.-]*\w\.(?:ext)\b/g`) re-attempted
 * the backtracking match at every index of a long charset-only run —
 * quadratic on adversarial input (a 200KB unbroken near-miss run ≈ tens of
 * seconds, main-thread). Splitting bounds the engine to ONE anchored attempt
 * per segment; the single character-class star backtracks linearly.
 *
 * Token shape: project-relative POSIX paths ending in the asset extensions
 * the studio knows how to focus (`.jsx`, `.json` — which covers
 * `.data.json` —, `.md`, `.css`, `.svg`). Requires a word character before
 * the extension dot so a bare `.jsx` never matches.
 */
const FILE_TOKEN_SPLIT_RE = /[^\w@/.-]+/;
const FILE_TOKEN_ANCHORED_RE = /^[\w@/.-]*\w\.(?:jsx|json|md|css|svg)\b/;

/** Cap on targeted reads per turn — bounds prompt size + read fan-out. */
const MAX_TARGETED_READS = 5;

/** Per-file content cap (characters) folded into the provider prompt. The cap
 * applies POST-read — the whole file is read, then sliced — because the v1
 * FilesystemAccess contract has no stat/partial-read surface; acceptable at
 * v1 asset-file sizes. */
const MAX_FILE_CHARS = 6000;

/**
 * Extract the (deduplicated, order-preserving) file-path tokens from a
 * question. Exported for the unit tests; pure string work, linear in the
 * prompt length (see the pattern-pair comment above).
 *
 * @param {unknown} prompt
 * @returns {string[]}
 */
export function extractFileTokens(prompt) {
    const text = typeof prompt === 'string' ? prompt : '';
    const seen = new Set();
    const out = [];
    for (const segment of text.split(FILE_TOKEN_SPLIT_RE)) {
        const match = FILE_TOKEN_ANCHORED_RE.exec(segment);
        if (!match) continue;
        // Normalize a leading `./` away; keep everything else verbatim.
        const token = match[0].replace(/^\.\//, '');
        if (token.length === 0 || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}

/**
 * Resolve a question token to an existing project-relative path via the
 * sandbox's non-mutating existence check. Tries the `.lerret/`-prefixed
 * spelling first (users rarely type the reserved-folder prefix), then the
 * token verbatim. Sandbox violations (paths outside `.lerret/`, traversal)
 * and backend errors are treated as "not found" — a question about a file
 * the Inspector cannot read NEVER fails the turn.
 *
 * @param {{ exists: (p: string) => Promise<boolean> }} sandbox
 * @param {string} token
 * @returns {Promise<string | null>}
 */
async function resolveReadablePath(sandbox, token) {
    const candidates = token.startsWith('.lerret/')
        ? [token]
        : [`.lerret/${token}`, token];
    for (const candidate of candidates) {
        try {
            if (await sandbox.exists(candidate)) return candidate;
        } catch {
            // SandboxViolationError (outside `.lerret/`) or backend error —
            // skip the candidate; the read surface stays strictly sandboxed.
        }
    }
    return null;
}

/**
 * Create the Inspector node.
 *
 * `sandbox` is OPTIONAL — when absent (or missing the non-mutating pair) the
 * node answers from the Memory context alone. When present, only its
 * `readFile` / `exists` members are ever touched; the write/delete/mkdir
 * surface is structurally unreferenced in this module (see header).
 *
 * @param {{
 *   sandbox?: import('./types.js').Sandbox,
 *   providerHandle: import('./types.js').ProviderHandle,
 *   emit: (ev: unknown) => void,
 * }} deps
 * @returns {(state: object) => Promise<{ answer: string }>}
 */
export function createInspectorNode({ sandbox, providerHandle, emit }) {
    const canRead =
        sandbox != null &&
        typeof sandbox.readFile === 'function' &&
        typeof sandbox.exists === 'function';

    return async function inspectorNode(state) {
        if (state?.signal?.aborted) return { answer: '' };
        emit(thinking());

        // ── Targeted READ-ONLY file inspection (AC-4) ────────────────────────
        // Gather the contents of files the question references. Reads emit
        // `reading{file}` so the dock pill cycles into Reading….
        /** @type {Array<{ path: string, text: string }>} */
        const fileExcerpts = [];
        if (canRead) {
            const tokens = extractFileTokens(state?.prompt).slice(0, MAX_TARGETED_READS);
            for (const token of tokens) {
                if (state?.signal?.aborted) return { answer: '' };
                const path = await resolveReadablePath(sandbox, token);
                if (!path) continue;
                try {
                    const raw = await sandbox.readFile(path, { encoding: 'utf-8' });
                    const text =
                        typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
                    emit(reading(path));
                    fileExcerpts.push({
                        path,
                        text:
                            text.length > MAX_FILE_CHARS
                                ? `${text.slice(0, MAX_FILE_CHARS)}\n…[truncated]`
                                : text,
                    });
                } catch {
                    // A read error on an existing file is non-fatal — the
                    // answer degrades to Memory context, never an error turn.
                }
            }
        }

        // ── Provider prompt: question + Memory context + file excerpts ──────
        const context = state?.context ? `\n\nProject context:\n${state.context}` : '';
        const filesBlock =
            fileExcerpts.length > 0
                ? `\n\nReferenced project files:\n${fileExcerpts
                      .map((f) => `--- ${f.path} ---\n${f.text}`)
                      .join('\n\n')}`
                : '';

        // Re-check the signal before the LLM call (a stop during the reads
        // should not pay for the inspector round-trip).
        if (state?.signal?.aborted) return { answer: '' };
        const result = await providerHandle.complete({
            messages: [
                {
                    role: 'system',
                    content:
                        'You are Lerret\'s read-only project inspector. Answer the user\'s ' +
                        'question about their project concisely. You CANNOT modify files in ' +
                        'this mode — the user\'s dock input is switched to Inspect, which is ' +
                        'read-only. The same dock input has an Ask mode that CAN create and ' +
                        'edit project files for them. If the user asks you to change, create, ' +
                        'or delete something, do NOT give manual-edit instructions — tell ' +
                        'them in one short sentence to switch the dock toggle from Inspect ' +
                        'to Ask and send the same request again, optionally adding one ' +
                        'sentence on which file(s) the change would touch. ' +
                        'When you reference a project file, write its project-relative ' +
                        'POSIX path verbatim (for example .lerret/social/card.jsx).' +
                        context +
                        filesBlock,
                },
                { role: 'user', content: String(state?.prompt ?? '') },
            ],
            signal: state?.signal,
        });
        // A stop that landed during the round-trip: the turn is stopped — do
        // not surface a half-orphaned answer event after the user cancelled.
        if (state?.signal?.aborted) return { answer: '' };

        const answer = result?.content ?? '';
        emit(inspectorResponse(answer));
        return { answer };
    };
}
