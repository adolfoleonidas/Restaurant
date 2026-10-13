/**
 * BS-03: what the waiter tapped and the server has not confirmed is kept on the
 * device. The same contract holds on IndexedDB and on the localStorage fallback,
 * and neither can ever make the order screen fail.
 */
import { createOutboxStorage } from '@/lib/outboxStorage';

const entriesFor = (orderId = 'o1', n = 2) => Array.from({ length: n }, (_, i) => ({
    key: `new:p${i}`, kind: 'new', productId: `p${i}`, orderId, clientLineId: `c-${orderId}-${i}`, quantity: i + 1, attempted: i === 0,
}));

/** localStorage double. */
function memoryLocal({ failWrites = false } = {}) {
    const data = new Map();
    return {
        data,
        get length() { return data.size; },
        key: (index) => [...data.keys()][index] ?? null,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => {
            if (failWrites) throw new Error('QuotaExceededError');
            data.set(key, String(value));
        },
        removeItem: (key) => { data.delete(key); },
    };
}

/** The part of IndexedDB the wrapper uses: open, one object store, put/get/getAll/delete in transactions. */
function fakeIndexedDB({ failTransactions = false, failOpen = false } = {}) {
    const data = new Map();
    let created = false;
    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
    return {
        data,
        open() {
            const request = {};
            setTimeout(() => {
                if (failOpen) { request.onerror?.(); return; }
                request.result = {
                    objectStoreNames: { contains: () => created },
                    createObjectStore: () => { created = true; },
                    transaction: () => {
                        if (failTransactions) throw new Error('InvalidStateError');
                        const tx = {};
                        const make = (work) => {
                            const req = {};
                            Promise.resolve().then(() => { req.result = work(); req.onsuccess?.(); });
                            return req;
                        };
                        tx.objectStore = () => ({
                            put: (value) => make(() => { data.set(value.key, clone(value)); }),
                            get: (key) => make(() => clone(data.get(key))),
                            getAll: () => make(() => [...data.values()].map(clone)),
                            delete: (key) => make(() => { data.delete(key); }),
                        });
                        setTimeout(() => tx.oncomplete?.(), 0);
                        return tx;
                    },
                };
                if (!created) request.onupgradeneeded?.();
                request.onsuccess?.();
            }, 0);
            return request;
        },
    };
}

describe.each([
    ['IndexedDB', () => createOutboxStorage({ indexedDB: fakeIndexedDB(), localStorage: memoryLocal() })],
    ['localStorage', () => createOutboxStorage({ indexedDB: null, localStorage: memoryLocal() })],
])('outbox storage on %s', (_name, make) => {
    let storage;
    beforeEach(() => { storage = make(); });

    it('saves what is waiting and loads it back for the same user and order', async () => {
        await expect(storage.save('u1', 'o1', entriesFor('o1'))).resolves.toBe(true);
        await expect(storage.load('u1', 'o1')).resolves.toEqual(entriesFor('o1'));
    });

    it('keeps users and orders apart', async () => {
        await storage.save('u1', 'o1', entriesFor('o1'));
        await storage.save('u1', 'o2', entriesFor('o2', 1));
        await storage.save('u2', 'o1', entriesFor('o1', 1));

        await expect(storage.load('u2', 'o2')).resolves.toEqual([]);
        await expect(storage.load('u1', 'o2')).resolves.toEqual(entriesFor('o2', 1));
        await expect(storage.load('u2', 'o1')).resolves.toEqual(entriesFor('o1', 1));
        const mine = await storage.list('u1');
        expect(mine.map((record) => record.orderId).sort()).toEqual(['o1', 'o2']);
        expect(mine.find((record) => record.orderId === 'o1').entries).toEqual(entriesFor('o1'));
        await expect(storage.list('nobody')).resolves.toEqual([]);
    });

    it('a new save replaces the old one, and an empty save removes the record', async () => {
        await storage.save('u1', 'o1', entriesFor('o1', 3));
        await storage.save('u1', 'o1', entriesFor('o1', 1));
        await expect(storage.load('u1', 'o1')).resolves.toEqual(entriesFor('o1', 1));

        await storage.save('u1', 'o1', []);
        await expect(storage.load('u1', 'o1')).resolves.toEqual([]);
        await expect(storage.list('u1')).resolves.toEqual([]);
    });

    it('removes a record, and a conditional remove only when nothing changed since it was read', async () => {
        await storage.save('u1', 'o1', entriesFor('o1', 1));
        const [{ signature }] = await storage.list('u1');

        // The waiter tapped again after the replay read the record: it must survive.
        await storage.save('u1', 'o1', entriesFor('o1', 2));
        await storage.remove('u1', 'o1', { ifSignature: signature });
        await expect(storage.load('u1', 'o1')).resolves.toEqual(entriesFor('o1', 2));

        const [{ signature: current }] = await storage.list('u1');
        await storage.remove('u1', 'o1', { ifSignature: current });
        await expect(storage.load('u1', 'o1')).resolves.toEqual([]);

        await storage.save('u1', 'o1', entriesFor('o1', 1));
        await storage.remove('u1', 'o1');
        await expect(storage.load('u1', 'o1')).resolves.toEqual([]);
    });

    it('ignores a call without a user or an order', async () => {
        await expect(storage.save(null, 'o1', entriesFor())).resolves.toBe(false);
        await expect(storage.save('u1', null, entriesFor())).resolves.toBe(false);
        await expect(storage.load(null, 'o1')).resolves.toEqual([]);
        await expect(storage.list(null)).resolves.toEqual([]);
        await expect(storage.remove('u1', null)).resolves.toBe(false);
    });
});

describe('outbox storage fallbacks', () => {
    it('uses localStorage when IndexedDB does not exist', async () => {
        const local = memoryLocal();
        const storage = createOutboxStorage({ indexedDB: undefined, localStorage: local });
        await storage.save('u1', 'o1', entriesFor('o1'));
        expect(local.data.size).toBe(1);
        expect([...local.data.keys()][0]).toMatch(/^restoflow:outbox:v1:u1:o1$/);
        await expect(storage.load('u1', 'o1')).resolves.toEqual(entriesFor('o1'));
    });

    it('uses localStorage when IndexedDB refuses to open', async () => {
        const local = memoryLocal();
        const storage = createOutboxStorage({ indexedDB: fakeIndexedDB({ failOpen: true }), localStorage: local });
        await expect(storage.save('u1', 'o1', entriesFor('o1'))).resolves.toBe(true);
        expect(local.data.size).toBe(1);
        await expect(storage.load('u1', 'o1')).resolves.toEqual(entriesFor('o1'));
    });

    it('uses the browser storage by default (jsdom has no IndexedDB)', async () => {
        const storage = createOutboxStorage();
        await storage.save('u-default', 'o1', entriesFor('o1', 1));
        expect(window.localStorage.length).toBeGreaterThan(0);
        await expect(storage.load('u-default', 'o1')).resolves.toEqual(entriesFor('o1', 1));
        await storage.remove('u-default', 'o1');
        await expect(storage.load('u-default', 'o1')).resolves.toEqual([]);
    });

    it('never throws when the disk is full or the storage is blocked', async () => {
        const full = createOutboxStorage({ indexedDB: null, localStorage: memoryLocal({ failWrites: true }) });
        await expect(full.save('u1', 'o1', entriesFor('o1'))).resolves.toBe(false);
        await expect(full.load('u1', 'o1')).resolves.toEqual([]);

        const none = createOutboxStorage({ indexedDB: null, localStorage: null });
        await expect(none.save('u1', 'o1', entriesFor('o1'))).resolves.toBe(false);
        await expect(none.load('u1', 'o1')).resolves.toEqual([]);
        await expect(none.list('u1')).resolves.toEqual([]);
        await expect(none.remove('u1', 'o1')).resolves.toBe(false);
    });

    it('never throws when an IndexedDB transaction fails', async () => {
        const broken = createOutboxStorage({ indexedDB: fakeIndexedDB({ failTransactions: true }), localStorage: memoryLocal() });
        await expect(broken.save('u1', 'o1', entriesFor('o1'))).resolves.toBe(false);
        await expect(broken.load('u1', 'o1')).resolves.toEqual([]);
        await expect(broken.list('u1')).resolves.toEqual([]);
        await expect(broken.remove('u1', 'o1')).resolves.toBe(false);
    });

    it('skips records that are corrupted or from another version', async () => {
        const local = memoryLocal();
        local.setItem('restoflow:outbox:v1:u1:o1', '{not json');
        local.setItem('restoflow:outbox:v1:u1:o2', JSON.stringify({ userId: 'u1', orderId: 'o2', entries: 'nope' }));
        local.setItem('restoflow:outbox:v1:u1:o3', JSON.stringify({ userId: 'someone-else', orderId: 'o3', entries: entriesFor('o3') }));
        const storage = createOutboxStorage({ indexedDB: null, localStorage: local });

        await expect(storage.load('u1', 'o1')).resolves.toEqual([]);
        await expect(storage.load('u1', 'o2')).resolves.toEqual([]);
        await expect(storage.load('u1', 'o3')).resolves.toEqual([]);
        await expect(storage.list('u1')).resolves.toEqual([]);
    });
});
