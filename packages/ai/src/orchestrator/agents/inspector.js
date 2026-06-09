// Inspector agent — read-only project Q&A (FR58).
//
// The Inspector answers questions about the project WITHOUT mutating anything.
// It reads files through the sandbox's non-mutating `readFile`/`exists` and
// calls the provider through the passed-in handle. It NEVER invokes the
// Worker — and structurally cannot, because the graph's inspect branch goes
// Orchestrator → Inspector → END, never reaching the Worker node.
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
