import {
    flushAllOutboxes, hasPendingOutbox, ownsOrder, registerOutbox,
} from '@/lib/outboxRegistry';

const handle = ({ pending = false, orderIds = [], flush } = {}) => {
    const state = { pending };
    return {
        state,
        pending: () => state.pending,
        orderIds: () => orderIds,
        flush: flush || jest.fn(async () => { state.pending = false; }),
    };
};

const offs = [];
const add = (outbox) => { offs.push(registerOutbox(outbox)); return outbox; };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
    while (offs.length) offs.pop()();
    jest.useRealTimers();
});

describe('outbox registry', () => {
    it('knows whether some live outbox holds unsaved lines', () => {
        expect(hasPendingOutbox()).toBe(false);
        const quiet = add(handle());
        expect(hasPendingOutbox()).toBe(false);
        const busy = add(handle({ pending: true }));
        expect(hasPendingOutbox()).toBe(true);
        busy.state.pending = false;
        expect(hasPendingOutbox()).toBe(false);
        expect(quiet.flush).not.toHaveBeenCalled();
    });

    it('forgets an outbox when it unregisters', () => {
        const off = registerOutbox(handle({ pending: true }));
        expect(hasPendingOutbox()).toBe(true);
        off();
        expect(hasPendingOutbox()).toBe(false);
    });

    it('says which orders a live outbox owns', () => {
        add(handle({ pending: true, orderIds: ['o1', 'o2'] }));
        expect(ownsOrder('o1')).toBe(true);
        expect(ownsOrder('o2')).toBe(true);
        expect(ownsOrder('o3')).toBe(false);
    });

    it('flushes only the outboxes that have something waiting, and resolves true once they are empty', async () => {
        const waiting = add(handle({ pending: true }));
        const idle = add(handle());
        await expect(flushAllOutboxes()).resolves.toBe(true);
        expect(waiting.flush).toHaveBeenCalledTimes(1);
        // The page may be about to reload: the requests must outlive it.
        expect(waiting.flush).toHaveBeenCalledWith({ keepalive: true });
        expect(idle.flush).not.toHaveBeenCalled();
    });

    it('resolves true at once when nothing is waiting', async () => {
        add(handle());
        await expect(flushAllOutboxes()).resolves.toBe(true);
    });

    it('gives up after the timeout and reports that something is still unsaved', async () => {
        const stuck = add(handle({ pending: true, flush: jest.fn(() => new Promise(() => {})) }));
        const result = flushAllOutboxes({ timeoutMs: 1500 });
        jest.advanceTimersByTime(1500);
        await expect(result).resolves.toBe(false);
        expect(stuck.flush).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('reports unsaved lines when the flush ends but the connection is down', async () => {
        add(handle({ pending: true, flush: jest.fn(async () => {}) }));
        await expect(flushAllOutboxes()).resolves.toBe(false);
    });

    it('a flush that fails does not break the others', async () => {
        add(handle({ pending: true, flush: jest.fn(async () => { throw new Error('boom'); }) }));
        const fine = add(handle({ pending: true }));
        await flushAllOutboxes();
        expect(fine.flush).toHaveBeenCalledTimes(1);
    });
});
