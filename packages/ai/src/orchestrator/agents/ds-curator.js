// DS Curator agent — owns brand-token authority.
//
// Authority order (architecture-epic-8.md §Multi-Agent Orchestrator + the
// change-proposal open-question-#3 decision): `_design-system.md` is PRIMARY;
// `config.json` `vars` is the SECONDARY, code-facing layer. When the two
// DISAGREE on a token, the DS Curator surfaces a clarifying note to the user
// (a tool-call event) but PROCEEDS with the `_design-system.md` value — it
// never auto-reconciles.
//
// Story 8.3 ships the authority-order skeleton + the conflict-note event.
// Story 8.6 extends with the full token-reference resolution ("our orange" →
// the actual hex) and richer conflict surfacing — extend, do not rewrite.

import { toolCall } from '../events.js';

const DESIGN_SYSTEM_PATH = '.lerret/_design-system.md';
const PROJECT_CONFIG_PATH = '.lerret/config.json';

/**
 * Parse a very small subset of brand tokens out of a `_design-system.md` body:
 * lines of the form `- name: value` or `name: value` under a tokens-ish
 * heading. Deliberately lenient — Story 8.6 replaces this with a real parser.
 *
 * @param {string} md
 * @returns {Record<string, string>}
 */
function parseDesignSystemTokens(md) {
    // Null-prototype map so a `__proto__`/`constructor`/`prototype`-named token
    // is stored as a real key (not a silent no-op write to the proto slot) and
    // cannot pollute Object.prototype.
    /** @type {Record<string, string>} */
    const tokens = Object.create(null);
    for (const raw of md.split('\n')) {
        const line = raw.replace(/^\s*[-*]\s*/, '').trim();
        const m = /^([A-Za-z][\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8}|[^\s].*)$/.exec(line);
        if (m) tokens[m[1].toLowerCase()] = m[2].trim();
    }
    return tokens;
}

/**
 * Create the DS Curator node. Reads `_design-system.md` (primary) and the
 * project `config.json` `vars` (secondary); records the resolved token map in
 * the `brandTokens` state slot and emits a conflict note for any token the two
 * sources disagree on.
 *
 * @param {{ sandbox: import('./types.js').Sandbox, emit: (ev: unknown) => void }} deps
 * @returns {(state: object) => Promise<{ brandTokens: Record<string, string> }>}
 */
export function createDsCuratorNode({ sandbox, emit }) {
    return async function dsCuratorNode(state) {
        if (state?.signal?.aborted) return { brandTokens: {} };

        /** @type {Record<string, string>} */
        let primary = Object.create(null);
        /** @type {Record<string, string>} */
        const secondary = Object.create(null);

        try {
            if (await sandbox.exists(DESIGN_SYSTEM_PATH)) {
                const raw = await sandbox.readFile(DESIGN_SYSTEM_PATH, { encoding: 'utf-8' });
                const md = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
                primary = parseDesignSystemTokens(md);
            }
        } catch {
            // graceful absence
        }

        try {
            if (await sandbox.exists(PROJECT_CONFIG_PATH)) {
                const raw = await sandbox.readFile(PROJECT_CONFIG_PATH, { encoding: 'utf-8' });
                const json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
                const vars = json && typeof json.vars === 'object' && json.vars ? json.vars : {};
                for (const [k, v] of Object.entries(vars)) {
                    if (typeof v === 'string') secondary[k.toLowerCase()] = v;
                }
            }
        } catch {
            // graceful absence / malformed config
        }

        // Resolve with `_design-system.md` PRIMARY; config vars fill gaps.
        /** @type {Record<string, string>} */
        const resolved = { ...secondary, ...primary };

        // Surface conflicts (same token, different value) — proceed with primary.
        for (const key of Object.keys(primary)) {
            if (key in secondary && secondary[key] !== primary[key]) {
                emit(
                    toolCall(
                        `brand-token conflict on '${key}': _design-system.md says '${primary[key]}', ` +
                            `config.json vars says '${secondary[key]}' — using _design-system.md (primary)`,
                    ),
                );
            }
        }

        return { brandTokens: resolved };
    };
}
