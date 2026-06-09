// Memory agent — reads the user's brand/context/memory files and injects the
// assembled context into downstream node prompts.
//
// Story 8.3 ships the read-and-inject skeleton with the reserved-path
// constants + graceful-absence behavior. Story 8.6 extends this with
// path-scoped anchoring and `_brand/` asset indexing — DO NOT rewrite the
// reserved-path set or the graceful-absence contract; extend around them.

import { reading } from '../events.js';

/**
 * The four reserved context paths under `.lerret/`, in injection order. Plain
 * Markdown the user owns; all are OPTIONAL (a fresh project has none).
 *
 * @type {readonly string[]}
 */
export const RESERVED_CONTEXT_PATHS = Object.freeze([
    '.lerret/_design-system.md',
    '.lerret/_context.md',
    '.lerret/_memory.md',
]);

/**
 * The `_brand/` asset folder under `.lerret/`. Story 8.6 indexes its contents;
 * this story only notes its presence.
 *
 * @type {string}
 */
export const BRAND_DIR = '.lerret/_brand';

/**
 * Create the Memory node. Reads each reserved path that exists (graceful
 * absence — a missing file contributes an empty section, never an error) and
 * returns the assembled context string in the `context` state slot.
 *
 * @param {{ sandbox: import('./types.js').Sandbox, emit: (ev: unknown) => void }} deps
 * @returns {(state: object) => Promise<{ context: string }>}
 */
export function createMemoryNode({ sandbox, emit }) {
    return async function memoryNode(state) {
        if (state?.signal?.aborted) return { context: '' };
        const sections = [];
        for (const path of RESERVED_CONTEXT_PATHS) {
            let present = false;
            try {
                present = await sandbox.exists(path);
            } catch {
                present = false;
            }
            if (!present) continue;
            try {
                const content = await sandbox.readFile(path, { encoding: 'utf-8' });
                const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
                if (text.trim().length > 0) {
                    emit(reading(path));
                    sections.push(`# ${path}\n\n${text.trim()}`);
                }
            } catch {
                // A read error on an existing file is non-fatal — skip it.
            }
        }
        // Story 8.6 extends: index `_brand/` and add an asset manifest section.
        return { context: sections.join('\n\n---\n\n') };
    };
}
