/**
 * BS-03: what a previous session left unconfirmed on the device is saved when the
 * app starts, with the same idempotent batch the composer sends.
 */
import { replayStoredOutboxes } from '@/lib/outboxReplay';

// The default sender is never used: each test injects its own.
jest.mock('@/lib/api/orders', () => ({ saveDraftLines: jest.fn() }));

const newEntry = (productId, quantity, extra = {}) => ({
    key: `new:${productId}`, kind: 'new', productId, orderId: 'o1', clientLineId: `c-${productId}`, quantity, ...extra,
});
const lineEntry = (lineId, quantity, extra = {}) => ({
    key: `line:${lineId}`, kind: 'line', lineId, orderId: 'o1', quantity, ...extra,
});
const httpError = (status, detail = 'No') => ({ response: { status, data: { detail } } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} });

const stored = (orderId, entries, signature = `sig-${orderId}`) => ({ orderId, entries, signature });

const make = (records, send = jest.fn().mockResolvedValue({ data: { line_results: [] } }), owned = () => false) => {
    const storage = {
        list: jest.fn().mockResolvedValue(records),
        remove: jest.fn().mockResolvedValue(true),
    };
    return { storage, send, owned };
};

describe('replaying the outbox a previous session left', () => {
    it('sends each stored order as one batch and then forgets it', async () => {
        const deps = make([
            stored('o1', [newEntry('p1', 2), lineEntry('l9', 3)]),
            stored('o2', [newEntry('p2', 1, { orderId: 'o2' })]),
        ]);
        const summary = await replayStoredOutboxes('u1', deps);

        expect(deps.storage.list).toHaveBeenCalledWith('u1');
        expect(deps.send).toHaveBeenCalledTimes(2);
        expect(deps.send).toHaveBeenNthCalledWith(1, 'o1', [
            { client_line_id: 'c-p1', product_id: 'p1', quantity: 2 },
            { client_line_id: 'l9', quantity: 3 },
        ]);
        expect(deps.send).toHaveBeenNthCalledWith(2, 'o2', [{ client_line_id: 'c-p2', product_id: 'p2', quantity: 1 }]);
        // Forgotten only if nothing was saved after it was read.
        expect(deps.storage.remove).toHaveBeenCalledWith('u1', 'o1', { ifSignature: 'sig-o1' });
        expect(deps.storage.remove).toHaveBeenCalledWith('u1', 'o2', { ifSignature: 'sig-o2' });
        expect(summary).toEqual({
            orders: 2, sent: 3, rejected: 0, kept: 0,
        });
    });

    it('does nothing without a user or without anything stored', async () => {
        const none = make([]);
        await expect(replayStoredOutboxes(null, none)).resolves.toEqual({
            orders: 0, sent: 0, rejected: 0, kept: 0,
        });
        expect(none.storage.list).not.toHaveBeenCalled();
        await replayStoredOutboxes('u1', none);
        expect(none.send).not.toHaveBeenCalled();
    });

    it('skips an order that a live composer holds', async () => {
        const deps = make([stored('o1', [newEntry('p1', 1)]), stored('o2', [newEntry('p2', 1, { orderId: 'o2' })])], undefined, (id) => id === 'o1');
        await replayStoredOutboxes('u1', deps);

        expect(deps.send).toHaveBeenCalledTimes(1);
        expect(deps.send.mock.calls[0][0]).toBe('o2');
        expect(deps.storage.remove).not.toHaveBeenCalledWith('u1', 'o1', expect.anything());
    });

    it('does not send a product that was tapped down to zero before it ever left, and forgets the record', async () => {
        const deps = make([stored('o1', [newEntry('p1', 0)])]);
        await replayStoredOutboxes('u1', deps);

        expect(deps.send).not.toHaveBeenCalled();
        expect(deps.storage.remove).toHaveBeenCalledWith('u1', 'o1', { ifSignature: 'sig-o1' });
    });

    it('still sends a removal for a line whose first answer may have been lost', async () => {
        const deps = make([stored('o1', [newEntry('p1', 0, { attempted: true })])]);
        await replayStoredOutboxes('u1', deps);

        expect(deps.send).toHaveBeenCalledWith('o1', [{ client_line_id: 'c-p1', product_id: 'p1', quantity: 0 }]);
    });

    it('keeps the record when the connection fails, and tries the other orders', async () => {
        const send = jest.fn()
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue({ data: { line_results: [] } });
        const deps = make([stored('o1', [newEntry('p1', 1)]), stored('o2', [newEntry('p2', 1, { orderId: 'o2' })])], send);
        const summary = await replayStoredOutboxes('u1', deps);

        expect(deps.storage.remove).toHaveBeenCalledTimes(1);
        expect(deps.storage.remove).toHaveBeenCalledWith('u1', 'o2', { ifSignature: 'sig-o2' });
        expect(summary).toEqual({
            orders: 2, sent: 1, rejected: 0, kept: 1,
        });
    });

    it('forgets a batch the server refused, because it will not change its mind', async () => {
        const send = jest.fn().mockRejectedValue(httpError(400, 'No se puede modificar un pedido cerrado'));
        const deps = make([stored('o1', [newEntry('p1', 1), newEntry('p2', 2)])], send);
        const summary = await replayStoredOutboxes('u1', deps);

        expect(deps.storage.remove).toHaveBeenCalledWith('u1', 'o1', { ifSignature: 'sig-o1' });
        expect(summary).toEqual({
            orders: 1, sent: 0, rejected: 2, kept: 0,
        });
    });

    it('counts the lines the server rejected one by one', async () => {
        const send = jest.fn().mockResolvedValue({
            data: { line_results: [{ client_line_id: 'c-p1', result: 'applied' }, { client_line_id: 'c-p2', result: 'rejected', code: 'unavailable' }] },
        });
        const deps = make([stored('o1', [newEntry('p1', 1), newEntry('p2', 1)])], send);
        const summary = await replayStoredOutboxes('u1', deps);

        expect(summary).toEqual({
            orders: 1, sent: 1, rejected: 1, kept: 0,
        });
        expect(deps.storage.remove).toHaveBeenCalledTimes(1);
    });

    it('sends a batch again when the order changed under it, up to twice', async () => {
        const send = jest.fn()
            .mockRejectedValueOnce(httpError(409))
            .mockRejectedValueOnce(httpError(409))
            .mockResolvedValue({ data: { line_results: [] } });
        const deps = make([stored('o1', [newEntry('p1', 1)])], send);
        const summary = await replayStoredOutboxes('u1', deps);

        expect(send).toHaveBeenCalledTimes(3);
        expect(summary.sent).toBe(1);
        expect(deps.storage.remove).toHaveBeenCalledTimes(1);
    });
});
