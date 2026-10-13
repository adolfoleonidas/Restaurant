/**
 * The order outboxes that are alive right now (BS-03).
 *
 * Each composer registers its outbox while it is mounted. The rest of the app,
 * which knows nothing about composers, asks from here:
 * - logout: is something unsaved? (`hasPendingOutbox`)
 * - the service-worker update, which reloads the page: save it first
 *   (`flushAllOutboxes`)
 * - the replay of what a previous session left on the device: skip the orders a
 *   live outbox already owns (`ownsOrder`)
 *
 * A handle is `{ pending(), flush(options), orderIds() }`.
 */
const outboxes = new Set();

export function registerOutbox(handle) {
    outboxes.add(handle);
    return () => { outboxes.delete(handle); };
}

/** Some outbox holds lines the server has not confirmed. */
export function hasPendingOutbox() {
    return [...outboxes].some((outbox) => outbox.pending());
}

/** A live outbox is holding unsaved lines for this order. */
export function ownsOrder(orderId) {
    return [...outboxes].some((outbox) => outbox.orderIds().includes(orderId));
}

/**
 * Sends everything that is waiting, in any outbox, and gives up after
 * `timeoutMs` (a page that is about to reload must not hang on a dead
 * connection; whatever is left stays on the device and is replayed later).
 * Resolves true when nothing is left unsaved.
 */
export async function flushAllOutboxes({ timeoutMs = 2500, keepalive = true } = {}) {
    const waiting = [...outboxes].filter((outbox) => outbox.pending());
    if (!waiting.length) return true;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    const flushed = Promise.all(waiting.map((outbox) => Promise.resolve(outbox.flush({ keepalive })).catch(() => {})));
    await Promise.race([flushed, timeout]);
    clearTimeout(timer);
    return !hasPendingOutbox();
}
