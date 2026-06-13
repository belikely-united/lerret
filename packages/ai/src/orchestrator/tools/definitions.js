// Tool contract — the neutral ToolDef/ToolCall/ToolResult shapes plus the
// ONLY four tool definitions the agent loop ever offers a model (ADR-006 §2:
// list_dir / read_file / write_file / delete_file — no shell per FR51, no
// grep/glob, no string-replace edit in v1; unneeded at `.lerret/` scale).
//
// Descriptions are PRESCRIPTIVE on purpose (Anthropic tool-writing guidance):
// they tell the model WHEN and HOW to act ("ALWAYS call this before
// write_file"), not merely what the tool is — the description is the cheapest
// steering surface we have, riding the cached tools+system prefix on every
// loop iteration.
//
// The read-only asymmetry of the two lanes is STRUCTURAL at this layer: the
// Inspect lane is handed READ_TOOLS, so the write tools simply do not exist
// in its registry (ADR-006 §4) — enforced by the inspect-no-worker guard, not
// by prompt text.
//
// Output caps + the pure truncation helpers bound what one tool result
// re-sends on every subsequent iteration — context growth is the loop's
// dominant cost (ADR-006 Consequences). A truncation ALWAYS carries a
// guidance line telling the model how to narrow; never a silent cut. The
// executors (Story 9.3) apply these helpers; they live here so the caps and
// their wording are pinned next to the tools they govern.

/**
 * One tool offered to the model. `parameters` is a plain JSON-Schema object —
 * the provider translators (Story 9.2) map it onto each vendor's wire shape
 * verbatim (Anthropic `input_schema`, OpenAI `function.parameters`, Ollama
 * native `/api/chat` functions).
 *
 * @typedef {{ name: string, description: string, parameters: object }} ToolDef
 */

/**
 * One model-requested tool invocation, already provider-NEUTRAL: the
 * translators parse vendor quirks (JSON-string `arguments`, missing call ids)
 * at their boundary, so the loop only ever sees `{id, name, args}` with
 * `args` a plain object.
 *
 * @typedef {{ id: string, name: string, args: object }} ToolCall
 */

/**
 * The outcome of one ToolCall, fed back to the model in the combined
 * `{role: 'tool'}` history message. `isError: true` is the self-correction
 * channel (ADR-006 §3): failures become content the model reads and reacts
 * to — never a thrown turn.
 *
 * @typedef {{ callId: string, name: string, content: string, isError?: boolean }} ToolResult
 */

/**
 * Hard ceiling on entries one `list_dir` result may carry (architecture §3).
 * @type {number}
 */
export const LIST_DIR_MAX_ENTRIES = 200;

/**
 * Hard ceiling on characters one `read_file` result may carry
 * (architecture §3).
 * @type {number}
 */
export const READ_FILE_CHAR_CAP = 12000;

// Every path parameter uses the SAME description — one identity shape at the
// seam (retro addendum-5 lesson); the executors normalize either spelling via
// toProjectRelativeLerretPath.
const PATH_DESCRIPTION =
    'project-relative path under .lerret/, e.g. social/card.jsx or .lerret/social/card.jsx';

/**
 * Freeze a tool definition (and its nested schema) so a translator or prompt
 * builder can never quietly reshape the contract mid-flight.
 *
 * @param {object} value
 * @returns {object}
 */
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

/** @type {ToolDef} */
export const LIST_DIR_TOOL = deepFreeze({
    name: 'list_dir',
    description:
        "List the immediate children of a project folder (name, kind, and size when available). Start at '.lerret/' to discover the project structure.",
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: PATH_DESCRIPTION },
        },
        required: ['path'],
        additionalProperties: false,
    },
});

/** @type {ToolDef} */
export const READ_FILE_TOOL = deepFreeze({
    name: 'read_file',
    description:
        "Read one project file's current content. ALWAYS call this before write_file on any existing file.",
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: PATH_DESCRIPTION },
        },
        required: ['path'],
        additionalProperties: false,
    },
});

/** @type {ToolDef} */
export const WRITE_FILE_TOOL = deepFreeze({
    name: 'write_file',
    description:
        'Write the COMPLETE new content of one file under .lerret/. Creates parent folders automatically. Never write partial content.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: PATH_DESCRIPTION },
            content: {
                type: 'string',
                description:
                    'The complete new file content. The file becomes exactly this — include every line you want to keep.',
            },
        },
        required: ['path', 'content'],
        additionalProperties: false,
    },
});

/** @type {ToolDef} */
export const DELETE_FILE_TOOL = deepFreeze({
    name: 'delete_file',
    description:
        'Permanently delete one file under .lerret/. Use ONLY when the request clearly calls for removal — to change a file, prefer write_file over delete-and-recreate.',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: PATH_DESCRIPTION },
        },
        required: ['path'],
        additionalProperties: false,
    },
});

/**
 * Pause and ask the USER a question at a genuine decision fork (Epic 9
 * follow-up). The loop blocks on a dock affordance; the user's pick (or typed
 * answer) returns as this tool's result, and the SAME turn continues. The
 * prescriptive description is the guardrail against over-asking — an agent
 * that interrogates is worse than one that picks a sensible default.
 *
 * Ask lane only — the Inspect lane answers in one shot and never pauses, so
 * `ask_user` is absent from READ_TOOLS by construction.
 *
 * @type {ToolDef}
 */
export const ASK_USER_TOOL = deepFreeze({
    name: 'ask_user',
    description:
        'Ask the user a SHORT question and wait for their answer — ONLY at a genuine fork where ' +
        'proceeding on a default could betray their intent: a brand/design conflict (their request ' +
        'fights the design system), a genuinely ambiguous target, or a destructive/irreversible scope. ' +
        'Do NOT ask about trivia, formatting, or anything a tool (list_dir/read_file) can answer — ' +
        'prefer to act on the most sensible default and mention it in your summary. Offer 2–4 concrete ' +
        '`options` when there is a clear set of choices; the user can always type their own. Ask at ' +
        'most a couple of times per task.',
    parameters: {
        type: 'object',
        properties: {
            question: {
                type: 'string',
                description: 'The single, specific question to ask — one sentence, no preamble.',
            },
            options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional 2–4 concrete choices the user can pick from (short labels).',
            },
        },
        required: ['question'],
        additionalProperties: false,
    },
});

/**
 * The Inspect lane's ENTIRE tool surface — read-only by construction
 * (ADR-006 §4). The write tools (and ask_user) are absent, not disabled.
 *
 * @type {readonly ToolDef[]}
 */
export const READ_TOOLS = Object.freeze([LIST_DIR_TOOL, READ_FILE_TOOL]);

/**
 * The Ask lane's tool surface — the four file tools plus the ask_user fork
 * (ADR-006 §2 + Epic 9 follow-up).
 *
 * @type {readonly ToolDef[]}
 */
export const ALL_TOOLS = Object.freeze([
    ...READ_TOOLS,
    WRITE_FILE_TOOL,
    DELETE_FILE_TOOL,
    ASK_USER_TOOL,
]);

/**
 * Format `list_dir` entries as the model-facing `name · kind · size` listing
 * (architecture §3): sorted by name, capped at {@link LIST_DIR_MAX_ENTRIES}
 * with a guidance line that says HOW to narrow. Pure — executors (Story 9.3)
 * feed it the sandbox's entry objects.
 *
 * @param {Array<{ name: string, kind: 'file'|'dir', size?: number }>} entries
 * @returns {string}
 */
export function formatListing(entries) {
    const list = Array.isArray(entries)
        ? entries.filter((e) => e && typeof e === 'object')
        : [];
    if (list.length === 0) return '(empty folder)';
    const sorted = [...list].sort((a, b) => {
        const an = String(a.name);
        const bn = String(b.name);
        return an < bn ? -1 : an > bn ? 1 : 0;
    });
    const lines = sorted
        .slice(0, LIST_DIR_MAX_ENTRIES)
        .map((e) =>
            Number.isFinite(e.size) ? `${e.name} · ${e.kind} · ${e.size} B` : `${e.name} · ${e.kind}`,
        );
    if (sorted.length > LIST_DIR_MAX_ENTRIES) {
        lines.push(
            `…[${LIST_DIR_MAX_ENTRIES} of ${sorted.length} entries shown — list a subfolder to narrow]`,
        );
    }
    return lines.join('\n');
}

/**
 * Cap one `read_file` result at {@link READ_FILE_CHAR_CAP} characters
 * (architecture §3). Under the cap the content passes through UNTOUCHED;
 * over it, the cut carries a guidance line naming the cap so the model knows
 * the file continues. Pure — executors (Story 9.3) apply it to the sandbox's
 * read result.
 *
 * @param {string} content
 * @returns {string}
 */
export function capFileContent(content) {
    const text = typeof content === 'string' ? content : String(content ?? '');
    if (text.length <= READ_FILE_CHAR_CAP) return text;
    return `${text.slice(0, READ_FILE_CHAR_CAP)}\n…[truncated at ${READ_FILE_CHAR_CAP} chars — the file continues]`;
}
