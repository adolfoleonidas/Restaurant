/**
 * The outbox on the device (BS-03).
 *
 * What the waiter tapped and the server has not confirmed is kept here, one
 * record per user and order, so a reload, a crash, a phone that ran out of
 * battery or an app update does not lose it: the entries are replayed when the
 * order is opened again (and at app start). IndexedDB holds it; a browser
 * without it (or one that blocks it, like some private modes) falls back to
 * `localStorage`.
 *
 * Storage is a safety net, never a dependency: every method resolves to a safe
 * value and none ever rejects, so a full disk or a blocked database can only
 * cost the net, never the order screen.
 *
 * A record is `{ key, userId, orderId, entries, signature, savedAt }`. The
 * `signature` is the serialized entries: `remove(..., { ifSignature })` deletes
 * only if nothing changed since the caller read the record, so a replay can
 * never erase taps that were saved after it started.
 */
const DB_NAME = 'restoflow-outbox';
const DB_VERSION = 1;
const STORE = 'draft-lines';
const LS_PREFIX = 'restoflow:outbox:v1:';

const quietly = (fn, fallback) => {
    try { return fn(); } catch { return fallback; }
};

const keyOf = (userId, orderId) => `${userId}:${orderId}`;

const makeRecord = (userId, orderId, entries) => ({
    key: keyOf(userId, orderId),
    userId,
    orderId,
    entries,
    signature: JSON.stringify(entries),
    savedAt: Date.now(),
});

const usable = (record, userId) => Boolean(
    record && record.userId === userId && record.orderId && Array.isArray(record.entries) && record.entries.length
);

/** Pass `{ indexedDB, localStorage }` to inject the storage (tests); otherwise the browser's. */
export function createOutboxStorage(options = {}) {
    const factory = () => ('indexedDB' in options ? options.indexedDB : quietly(() => globalThis.indexedDB, null));
    const local = () => ('localStorage' in options ? options.localStorage : quietly(() => globalThis.localStorage, null));
    let opening = null;

    const openDb = () => {
        if (!opening) {
            opening = new Promise((resolve) => {
                const idb = factory();
                if (!idb) {
                    resolve(null);
                    return;
                }
                try {
                    const request = idb.open(DB_NAME, DB_VERSION);
                    request.onupgradeneeded = () => {
                        const db = request.result;
                        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
                    };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(null);
                    request.onblocked = () => resolve(null);
                } catch {
                    resolve(null);
                }
            });
        }
        return opening;
    };

    /** One transaction on the store. Resolves `{ ok, value }`; never rejects. */
    const transact = async (mode, work) => {
        const db = await openDb();
        if (!db) return { ok: false };
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE, mode);
                const request = work(tx.objectStore(STORE));
                tx.oncomplete = () => resolve({ ok: true, value: request?.result });
                tx.onerror = () => resolve({ ok: false });
                tx.onabort = () => resolve({ ok: false });
            } catch {
                resolve({ ok: false });
            }
        });
    };

    const localKeys = () => quietly(() => {
        const store = local();
        const keys = [];
        for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            if (key && key.startsWith(LS_PREFIX)) keys.push(key);
        }
        return keys;
    }, []);

    const readLocal = (key) => quietly(() => JSON.parse(local().getItem(key)), null);

    const remove = async (userId, orderId, { ifSignature } = {}) => {
        if (!userId || !orderId) return false;
        if (await openDb()) {
            const key = keyOf(userId, orderId);
            const { ok } = await transact('readwrite', (store) => {
                if (ifSignature === undefined) return store.delete(key);
                const read = store.get(key);
                read.onsuccess = () => {
                    if (read.result && read.result.signature === ifSignature) store.delete(key);
                };
                return read;
            });
            return ok;
        }
        return quietly(() => {
            const key = `${LS_PREFIX}${keyOf(userId, orderId)}`;
            if (ifSignature !== undefined && readLocal(key)?.signature !== ifSignature) return true;
            local().removeItem(key);
            return true;
        }, false);
    };

    const save = async (userId, orderId, entries) => {
        if (!userId || !orderId) return false;
        if (!entries || !entries.length) return remove(userId, orderId);
        const record = makeRecord(userId, orderId, entries);
        if (await openDb()) return (await transact('readwrite', (store) => store.put(record))).ok;
        return quietly(() => {
            local().setItem(`${LS_PREFIX}${record.key}`, JSON.stringify(record));
            return true;
        }, false);
    };

    /** The entries saved for one order, or an empty list. */
    const load = async (userId, orderId) => {
        if (!userId || !orderId) return [];
        if (await openDb()) {
            const { value } = await transact('readonly', (store) => store.get(keyOf(userId, orderId)));
            return usable(value, userId) ? value.entries : [];
        }
        const record = readLocal(`${LS_PREFIX}${keyOf(userId, orderId)}`);
        return usable(record, userId) ? record.entries : [];
    };

    /** Everything saved for a user: `[{ orderId, entries, signature }]`. */
    const list = async (userId) => {
        if (!userId) return [];
        let records;
        if (await openDb()) {
            const { value } = await transact('readonly', (store) => store.getAll());
            records = value || [];
        } else {
            records = localKeys().map(readLocal);
        }
        return records
            .filter((record) => usable(record, userId))
            .map(({ orderId, entries, signature }) => ({ orderId, entries, signature }));
    };

    return {
        save, load, list, remove,
    };
}

export const outboxStorage = createOutboxStorage();
