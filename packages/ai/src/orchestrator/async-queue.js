// A minimal closable async queue — the bridge between the LangGraph nodes
// (which `emit(event)` synchronously as they execute) and the `runTurn` async
// generator (which drains the queue and yields TurnEvents to the consumer).
//
// The graph driver runs the nodes concurrently with the drain loop; the queue
// decouples their timing so a node mid-execution can push a `writing` event
// that the consumer's `for await` sees immediately, without the node having to
// return first. `close()` ends the iteration once the graph completes.

/**
 * @template T
 * @returns {{
 *   push: (item: T) => void,
 *   close: () => void,
 *   fail: (err: unknown) => void,
 *   [Symbol.asyncIterator]: () => AsyncIterator<T>,
 * }}
 */
export function createAsyncQueue() {
    /** @type {T[]} */
    const buffer = [];
    /** @type {Array<{ resolve: (r: IteratorResult<T>) => void, reject: (e: unknown) => void }>} */
    const waiters = [];
    let closed = false;
    /** @type {unknown} */
    let failure;

    function push(item) {
        if (closed) return;
        const waiter = waiters.shift();
        if (waiter) {
            waiter.resolve({ value: item, done: false });
        } else {
            buffer.push(item);
        }
    }

    function close() {
        if (closed) return;
        closed = true;
        // Resolve any pending waiters with done.
        while (waiters.length > 0) {
            waiters.shift().resolve({ value: undefined, done: true });
        }
    }

    function fail(err) {
        if (closed) return;
        failure = err;
        closed = true;
        while (waiters.length > 0) {
            waiters.shift().reject(err);
        }
    }

    return {
        push,
        close,
        fail,
        [Symbol.asyncIterator]() {
            return {
                next() {
                    if (buffer.length > 0) {
                        return Promise.resolve({ value: buffer.shift(), done: false });
                    }
                    if (failure !== undefined) {
                        const err = failure;
                        failure = undefined;
                        return Promise.reject(err);
                    }
                    if (closed) {
                        return Promise.resolve({ value: undefined, done: true });
                    }
                    return new Promise((resolve, reject) => {
                        waiters.push({ resolve, reject });
                    });
                },
            };
        },
    };
}
