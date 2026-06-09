// Inspector agent — read-only project Q&A (FR58).
//
// The Inspector answers questions about the project WITHOUT mutating anything.
// It calls the provider through the passed-in handle, using the project
// context the Memory node already gathered. It NEVER invokes the Worker — the
// graph's inspect branch routes Memory → Inspector → END, so the inspect path
// never REACHES the Worker node at runtime. (Story 8.9 adds targeted file
// reads via the sandbox's non-mutating readFile/exists; for now the Inspector
// answers from the Memory context only.)
//
// Story 8.3 ships the read-only node + the structural no-Worker guarantee.
// Story 8.9 fleshes out the Ask/Inspect routing, the inspector-response
// events, and richer project introspection — extend, do not rewrite.

import { thinking, toolCall } from '../events.js';

/**
 * Create the Inspector node.
 *
 * @param {{
 *   sandbox: import('./types.js').Sandbox,
 *   providerHandle: import('./types.js').ProviderHandle,
 *   emit: (ev: unknown) => void,
 * }} deps
 * @returns {(state: object) => Promise<{ answer: string }>}
 */
export function createInspectorNode({ providerHandle, emit }) {
    return async function inspectorNode(state) {
        if (state?.signal?.aborted) return { answer: '' };
        emit(thinking());

        // Answer the question using the project context the Memory node
        // gathered (Story 8.9 adds targeted file reads). Read-only — no
        // sandbox writes, no Worker.
        const context = state?.context ? `\n\nProject context:\n${state.context}` : '';
        // Re-check the signal before the LLM call (a stop during Memory should
        // not pay for the inspector round-trip).
        if (state?.signal?.aborted) return { answer: '' };
        const result = await providerHandle.complete({
            messages: [
                {
                    role: 'system',
                    content:
                        'You are Lerret\'s read-only project inspector. Answer the user\'s ' +
                        'question about their project concisely. You CANNOT modify files.' +
                        context,
                },
                { role: 'user', content: String(state?.prompt ?? '') },
            ],
            signal: state?.signal,
        });
        const answer = result?.content ?? '';
        emit(toolCall('inspect'));
        return { answer };
    };
}
