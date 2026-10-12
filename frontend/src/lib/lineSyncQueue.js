/**
 * Serial, coalescing sync queue for order lines.
 *
 * The screen changes a quantity the instant the waiter taps; this queue is what
 * makes the server catch up without losing a tap. Each key (one order line, or
 * one product that has no line yet) holds the quantity the waiter wants, not a
 * list of clicks:
 *
 * - Taps on the same key just overwrite the wanted quantity, so any number of
 *   taps made while a request is in flight collapse into one follow-up request.
 * - Exactly one request runs at a time, for the whole queue. That also keeps the
 *   account from being created twice and keeps later requests behind the one
 *   that creates the line they need.
 * - The wanted quantity is absolute. Re-reading the order (polling, a reload)
 *   can never double count a tap the way a "+1" delta could.
 * - A failed request drops only that key; the others still sync, and the caller
 *   gets `onError` so it can roll back and tell the waiter.
 *
 * `run(key, entry)` performs the server work for one entry and may mutate the
 * entry (for example to remember the id of the line it just created).
 */
export function createLineSyncQueue({
    run,
    onChange = () => {},
    onError = () => {},
    onDrain = () => {},
}) {
    const entries = new Map();
    let running = false;
    let scheduled = false;
    let failures = 0;
    let waiters = [];

    const settle = () => {
        const pending = waiters;
        waiters = [];
        pending.forEach((resolve) => resolve());
    };

    const pump = async () => {
        if (running) return;
        running = true;
        let worked = false;
        try {
            while (entries.size > 0) {
                const [key, entry] = entries.entries().next().value;
                const sent = entry.quantity;
                worked = true;
                try {
                    await run(key, entry);
                } catch (error) {
                    failures += 1;
                    entries.delete(key);
                    onChange();
                    try { onError(key, error, entry); } catch { /* the handler must not stall the queue */ }
                    continue;
                }
                entries.delete(key);
                // More taps arrived while it ran: the line goes to the back so
                // the other lines are not starved by someone tapping one product.
                if (entry.quantity !== sent) entries.set(key, entry);
                onChange();
            }
        } finally {
            running = false;
        }
        if (worked) {
            try { onDrain(); } catch { /* ignore */ }
        }
        settle();
    };

    // One microtask of delay lets taps made in the same event collapse together.
    const schedule = () => {
        if (running || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            void pump();
        });
    };

    return {
        /** Sets the wanted state of a key (merged into the entry if it exists). */
        set(key, patch) {
            const current = entries.get(key);
            if (current) Object.assign(current, patch);
            else entries.set(key, { ...patch });
            onChange();
            schedule();
        },
        get(key) {
            return entries.get(key);
        },
        /** Copy of everything not yet confirmed by the server, keyed by entry key. */
        snapshot() {
            const out = {};
            entries.forEach((entry, key) => { out[key] = { ...entry }; });
            return out;
        },
        busy() {
            return running || scheduled || entries.size > 0;
        },
        failures() {
            return failures;
        },
        /** Resolves once everything queued so far has been confirmed or has failed. */
        whenIdle() {
            if (!this.busy()) return Promise.resolve();
            return new Promise((resolve) => { waiters.push(resolve); });
        },
    };
}
