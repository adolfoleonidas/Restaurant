/**
 * Batching outbox for the lines of an order composer.
 *
 * The screen changes a quantity the instant the waiter taps; this outbox is what
 * makes the server catch up without a request per tap. Each key (one order line,
 * or one product that has no line yet) holds the quantity the waiter wants, not a
 * list of clicks:
 *
 * - Taps on the same key just overwrite the wanted quantity.
 * - Nothing is sent while the waiter keeps tapping: the whole outbox of an order
 *   goes out in ONE request `delayMs` after the last tap, or at once on `flush()`
 *   (send to the kitchen, leaving the composer, switching account, the app going
 *   to the background, ...).
 * - Exactly one request runs at a time. Taps made while it is in flight stay in
 *   the outbox and travel in the next batch, which the next pause (or flush)
 *   sends: a long burst of taps never becomes a chain of requests.
 * - A line that has no order yet makes the outbox create the order straight away
 *   (so the table shows as occupied), without waiting for the window.
 * - The wanted quantity is absolute, and the caller identifies lines by ids the
 *   server dedupes on, so sending the same batch twice never double counts.
 *
 * What a failure does depends on who is to blame:
 * - The server refused (a line, or the whole batch): the lines are dropped, so the
 *   screen goes back to what the server has, and `onError` says why, once.
 * - The connection failed (no answer, timeout, busy server, expired session):
 *   nothing was decided, so the lines stay, `onStalled` is told, and the outbox
 *   tries again with a growing pause or at the next flush. The entries are plain
 *   objects the sender may annotate: `run` flags the ones it dispatched, because
 *   a lost answer means the server may already hold them.
 *
 * `run({ orderId, items }, { keepalive })` sends one batch; `items` is
 * `[{ key, entry, sent }]` with the quantity each entry had when the batch was
 * taken. It resolves to `{ rejected: [{ key, error }] }` for lines the server
 * rejected on their own, and rejects when the whole request failed.
 * `resolveOrder({ requestId })` creates the order for lines that have none and
 * resolves to its id (or null when the caller already told the waiter why there
 * is none). `requestId` names that one creation: a lost answer means the server
 * may already hold the order, so every retry of the creation carries the same id
 * and the server answers with the order it made instead of making a second one.
 * A new creation (the next account) gets a new id.
 */
import { newClientId } from '@/lib/clientId';

export const ORDER_SYNC_DELAY_MS = 1500;
const RETRY_FIRST_MS = 4000;
const RETRY_MAX_MS = 30000;
const CONFLICT_RETRIES = 2;

const TRANSIENT_STATUS = [401, 408, 425, 429, 502, 503, 504];
const TRANSIENT_CODES = ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'];
const TRANSIENT_MESSAGE = /network|timeout|failed to fetch|load failed|aborted/i;

/** True when the failure says nothing about the batch itself: the same batch may work later. */
export function isTransientError(error) {
    const status = error?.response?.status;
    if (status) return TRANSIENT_STATUS.includes(status);
    return Boolean(error?.request)
        || TRANSIENT_CODES.includes(error?.code)
        || TRANSIENT_MESSAGE.test(String(error?.message || ''));
}

const isConflict = (error) => error?.response?.status === 409;

const quietly = (fn, ...args) => {
    try { return fn(...args); } catch { return undefined; }
};

export function createLineSyncQueue({
    run,
    resolveOrder = async () => null,
    delayMs = ORDER_SYNC_DELAY_MS,
    retryMs = RETRY_FIRST_MS,
    onChange = () => {},
    onError = () => {},
    onStalled = () => {},
    onDropped = () => {},
    onDrain = () => {},
}) {
    const entries = new Map();
    let windowTimer = null;
    let retryTimer = null;
    let backoff = retryMs;
    let running = false;
    let flying = false;
    let wantCreate = false;
    let wantSend = false;
    let wantKeepalive = false;
    let failures = 0;
    let destroyed = false;
    let waiters = [];
    // Names the order creation in progress, so a retry is recognised as the same creation. It lives
    // from the first attempt until the creation is over: the order exists, the caller wants none,
    // the server refused, or the draft was discarded. Not kept on the device: lines without an
    // order are not either (see `restore`), so no creation is replayed after a reload.
    let creationId = null;

    const changed = () => quietly(onChange);

    const clearWindow = () => {
        if (windowTimer !== null) clearTimeout(windowTimer);
        windowTimer = null;
    };
    const clearRetry = () => {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
    };

    const settle = () => {
        const pending = waiters;
        waiters = [];
        pending.forEach((resolve) => resolve());
    };

    const setFlying = (value) => {
        flying = value;
        changed();
    };

    // Lines the server refused or could not be told about: the screen goes back to the server.
    const refused = (error, items) => {
        failures += 1;
        items.forEach(({ key, entry }) => { if (entries.get(key) === entry) entries.delete(key); });
        changed();
        quietly(onError, error, items[0].entry, items[0].key, items.map((item) => item.entry));
    };

    // The connection failed: keep everything and try again later.
    const stalled = (error) => {
        failures += 1;
        quietly(onStalled, error);
        if (destroyed) return;
        clearRetry();
        retryTimer = setTimeout(() => {
            retryTimer = null;
            request({ send: true });
        }, backoff);
        backoff = Math.min(backoff * 2, RETRY_MAX_MS);
    };

    const withoutOrder = () => [...entries]
        .filter(([, entry]) => !entry.orderId)
        .map(([key, entry]) => ({ key, entry, sent: entry.quantity }));

    const createOrders = async () => {
        if (!withoutOrder().length) return false;
        setFlying(true);
        // The same id on every retry of this creation: if the answer was lost the server already
        // holds the order, and it hands that one back.
        creationId = creationId || newClientId();
        try {
            const orderId = await resolveOrder({ requestId: creationId });
            // The creation is over (an order, or none wanted): the next one is a new creation.
            creationId = null;
            // Every line that was waiting for the order joins it, the ones tapped meanwhile too.
            const waiting = withoutOrder();
            waiting.forEach(({ key, entry }) => {
                if (!orderId) entries.delete(key);
                else Object.assign(entry, { orderId });
            });
            // Nunca en silencio: si no hay cuenta donde ponerlas, el mozo tiene que
            // enterarse de que su toque no entró. Antes se borraban sin decir nada y
            // el resultado era "a veces sí, a veces no" y dar clics hasta que agarre.
            if (!orderId && waiting.length) quietly(onDropped, waiting);
        } catch (error) {
            const lacking = withoutOrder();
            // A connection that failed decided nothing: the retry is the same creation, same id.
            if (isTransientError(error)) stalled(error);
            else {
                creationId = null;
                if (lacking.length) refused(error, lacking);
            }
        } finally {
            setFlying(false);
        }
        return true;
    };

    const dispatch = async (orderId, items, keepalive) => {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await run({ orderId, items }, { keepalive });
            } catch (error) {
                if (!isConflict(error) || attempt >= CONFLICT_RETRIES) throw error;
            }
        }
    };

    const settleBatch = (items, outcome) => {
        const rejected = new Map((outcome?.rejected || []).map((entry) => [entry.key, entry.error]));
        items.forEach(({ key, entry, sent }) => {
            if (entries.get(key) !== entry) return;
            if (rejected.has(key)) {
                failures += 1;
                entries.delete(key);
                changed();
                quietly(onError, rejected.get(key), entry, key, [entry]);
            // Taps made while the batch was in flight stay for the next one.
            } else if (entry.quantity === sent) {
                entries.delete(key);
            }
        });
    };

    const groupsByOrder = () => {
        const groups = new Map();
        entries.forEach((entry, key) => {
            if (!entry.orderId) return;
            if (!groups.has(entry.orderId)) groups.set(entry.orderId, []);
            groups.get(entry.orderId).push({ key, entry, sent: entry.quantity });
        });
        return groups;
    };

    const sendBatches = async (keepalive) => {
        let worked = false;
        for (const [orderId, taken] of groupsByOrder()) {
            const items = taken.filter(({ key, entry }) => entries.get(key) === entry);
            if (!items.length) continue;
            worked = true;
            let connectionDown = false;
            setFlying(true);
            try {
                const outcome = await dispatch(orderId, items, keepalive);
                backoff = retryMs;
                settleBatch(items, outcome);
            } catch (error) {
                connectionDown = isTransientError(error);
                if (connectionDown) stalled(error);
                else refused(error, items);
            } finally {
                setFlying(false);
            }
            // No point trying the other orders on a connection that just failed.
            if (connectionDown) break;
        }
        return worked;
    };

    const drain = async () => {
        running = true;
        let worked = false;
        try {
            while ((wantCreate || wantSend) && !destroyed) {
                const send = wantSend;
                const keepalive = wantKeepalive;
                wantCreate = false;
                wantSend = false;
                wantKeepalive = false;
                if (await createOrders()) worked = true;
                if (send && await sendBatches(keepalive)) worked = true;
            }
        } finally {
            running = false;
        }
        if (worked && entries.size === 0) quietly(onDrain);
        changed();
        settle();
    };

    function request({ create = false, send = false, keepalive = false } = {}) {
        if (destroyed) return;
        wantCreate = wantCreate || create || send;
        wantSend = wantSend || send;
        wantKeepalive = wantKeepalive || keepalive;
        if (!running) void drain();
    }

    const arm = () => {
        if (destroyed) return;
        clearWindow();
        windowTimer = setTimeout(() => {
            windowTimer = null;
            request({ send: true });
        }, delayMs);
    };

    return {
        /** Sets the wanted state of a key (merged into the entry if it exists). */
        set(key, patch) {
            if (destroyed) return;
            const current = entries.get(key);
            if (current) Object.assign(current, patch);
            else entries.set(key, { ...patch });
            changed();
            arm();
            // The order is not waited for: the first line of an account creates it now.
            if (!entries.get(key).orderId) request({ create: true });
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
        /** Something is waiting for its window or on the way. */
        busy() {
            return running || entries.size > 0;
        },
        /** There are lines the server has not confirmed. */
        pending() {
            return entries.size > 0;
        },
        /** A request is on the wire. */
        inFlight() {
            return flying;
        },
        failures() {
            return failures;
        },
        /**
         * Sends everything now. Resolves once that attempt is over: the lines are
         * confirmed, refused, or (connection down) still waiting; check `pending()`.
         */
        flush({ keepalive = false } = {}) {
            clearWindow();
            if (destroyed || (!running && entries.size === 0)) return Promise.resolve();
            return new Promise((resolve) => {
                waiters.push(resolve);
                request({ send: true, keepalive });
            });
        },
        /**
         * Takes back entries a previous session left on the device (`[{ key, ...entry }]`)
         * and sends them. What the waiter tapped in this session wins: a key that is
         * already in the outbox is left as it is.
         */
        restore(saved) {
            if (destroyed) return;
            let added = false;
            saved.forEach(({ key, ...entry }) => {
                if (!key || entries.has(key)) return;
                entries.set(key, entry);
                added = true;
            });
            if (!added) return;
            changed();
            request({ send: true });
        },
        /** Forgets what is waiting (the waiter discarded the draft). */
        clear() {
            entries.clear();
            creationId = null;
            clearWindow();
            clearRetry();
            changed();
        },
        destroy() {
            destroyed = true;
            clearWindow();
            clearRetry();
            settle();
        },
    };
}
