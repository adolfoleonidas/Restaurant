/**
 * BS-02: the composer keeps taps on the device and saves them in one batch
 * (`PUT /orders/:id/draft-lines`) when the waiter pauses, or at once when
 * something asks for it. CP-02 still holds: the batch answers with the whole
 * order, and that answer confirms the lines without another GET.
 */
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import useOrderLineSync from '@/hooks/useOrderLineSync';
import { saveDraftLines } from '@/lib/api/orders';
import { ORDER_SYNC_DELAY_MS } from '@/lib/lineSyncQueue';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/orders', () => ({ saveDraftLines: jest.fn() }));

const sopa = { id: 'p-a', name: 'Sopa', price: 10 };
const lomo = { id: 'p-b', name: 'Lomo', price: 30 };

const line = (extra = {}) => ({
    id: 'a', product_id: 'p-a', product_name: 'Sopa', quantity: 2, unit_price: 10, subtotal: 20, status: 'borrador', notes: null, ...extra,
});
const orderWith = (items) => ({
    id: 'o1', status: 'nuevo', table_id: 't1', items, total: items.reduce((s, i) => s + i.subtotal, 0),
});
const placeholder = { id: null, status: 'nuevo', items: [], total: 0 };
const httpError = (status, detail) => ({ response: { status, data: { detail } } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} });

/** The server's answer: the whole order plus what happened to each line. */
const answer = (order, results = []) => ({ data: { ...order, line_results: results } });

let view;
let loadOrder;
let acceptOrder;
let onSynced;
let onError;
let onStalled;
let ensureOrderId;

const settle = () => act(async () => {
    for (let i = 0; i < 30; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
});
const pass = async (ms) => {
    await act(async () => { jest.advanceTimersByTime(ms); });
    await settle();
};
const quantityOf = (productId) => (view.result.current.order?.items || [])
    .filter((item) => item.product_id === productId)
    .reduce((sum, item) => sum + item.quantity, 0);

/**
 * Renders the hook under a parent that behaves like the real screens: it holds the
 * last order the server confirmed and `acceptOrder` / `loadOrder` replace it.
 */
const mount = async (initial = orderWith([line()]), extra = {}) => {
    const result = { current: null };
    function Host() {
        const [order, setOrder] = useState(initial);
        result.current = useOrderLineSync({
            order,
            placeholder,
            ensureOrderId,
            loadOrder: async (orderId) => {
                const data = await loadOrder(orderId);
                if (data) setOrder(data);
                return data;
            },
            acceptOrder: (saved) => { acceptOrder(saved); setOrder(saved); },
            onError,
            onStalled,
            onSynced,
            ...extra,
        });
        return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Host />); });
    view = {
        result,
        unmount: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
    return view;
};

const tap = async (product = sopa, direction = 1) => {
    await act(async () => { await view.result.current.tap(product, direction); });
};

beforeEach(() => {
    jest.useFakeTimers();
    ensureOrderId = jest.fn(async () => 'o1');
    loadOrder = jest.fn(async () => orderWith([line({ quantity: 3, subtotal: 30 })]));
    acceptOrder = jest.fn();
    onSynced = jest.fn();
    onError = jest.fn();
    onStalled = jest.fn();
    saveDraftLines.mockReset();
});

afterEach(async () => {
    if (view) await view.unmount();
    view = null;
    jest.useRealTimers();
});

describe('the batch window', () => {
    it('shows a tap at once and sends nothing until the waiter pauses', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount();

        await tap();
        expect(quantityOf('p-a')).toBe(3);
        expect(view.result.current.order.total).toBe(30);
        await pass(ORDER_SYNC_DELAY_MS - 1);
        expect(saveDraftLines).not.toHaveBeenCalled();

        await pass(1);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).toHaveBeenCalledWith('o1', [{ client_line_id: 'a', quantity: 3 }]);
    });

    it('sends the net quantity of a burst of taps in one request', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 5, subtotal: 50 })])));
        await mount();

        await tap();
        await tap();
        await tap();
        expect(quantityOf('p-a')).toBe(5);
        await pass(ORDER_SYNC_DELAY_MS);

        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines.mock.calls[0][1]).toEqual([{ client_line_id: 'a', quantity: 5 }]);
    });

    it('sends nothing when the taps net out to what the server already has', async () => {
        await mount();
        await tap(sopa, 1);
        await tap(sopa, -1);
        expect(quantityOf('p-a')).toBe(2);
        await pass(ORDER_SYNC_DELAY_MS * 2);

        expect(saveDraftLines).not.toHaveBeenCalled();
        expect(view.result.current.busy()).toBe(false);
    });

    it('removes a line with quantity 0 and keeps the screen at zero meanwhile', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([])));
        await mount(orderWith([line({ quantity: 1, subtotal: 10 })]));

        await tap(sopa, -1);
        expect(quantityOf('p-a')).toBe(0);
        await pass(ORDER_SYNC_DELAY_MS);

        expect(saveDraftLines.mock.calls[0][1]).toEqual([{ client_line_id: 'a', quantity: 0 }]);
        expect(acceptOrder).toHaveBeenCalledWith(orderWith([]));
    });

    it('flush sends at once', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount();
        await tap();

        await act(async () => { await view.result.current.flush(); });
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(view.result.current.pending()).toBe(false);
    });

    it('a tap does not wait for the server: its promise resolves at once', async () => {
        await mount();
        let resolved = false;
        await act(async () => { void view.result.current.tap(sopa, 1).then(() => { resolved = true; }); });
        expect(resolved).toBe(true);
        expect(saveDraftLines).not.toHaveBeenCalled();
    });
});

describe('write confirmation (CP-02)', () => {
    it('confirms the lines from the batch response without re-reading the order', async () => {
        const confirmed = orderWith([line({ quantity: 3, subtotal: 30 })]);
        saveDraftLines.mockResolvedValue(answer(confirmed, [{ client_line_id: 'a', result: 'applied', line_id: 'a' }]));
        await mount();
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(loadOrder).not.toHaveBeenCalled();
        expect(acceptOrder).toHaveBeenCalledTimes(1);
        // The accepted order is the server's order, without the per-line report.
        expect(acceptOrder).toHaveBeenCalledWith(confirmed);
        expect(acceptOrder.mock.calls[0][0]).not.toHaveProperty('line_results');
        expect(onSynced).toHaveBeenCalledTimes(1);
    });

    it('falls back to one GET when the response does not carry the order', async () => {
        saveDraftLines.mockResolvedValue({ data: {} });
        await mount();
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(loadOrder).toHaveBeenCalledTimes(1);
        expect(loadOrder).toHaveBeenCalledWith('o1');
        expect(acceptOrder).not.toHaveBeenCalled();
    });

    it('ignores a response for a different order', async () => {
        saveDraftLines.mockResolvedValue(answer({ ...orderWith([line()]), id: 'other' }));
        await mount();
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(acceptOrder).not.toHaveBeenCalled();
        expect(loadOrder).toHaveBeenCalledTimes(1);
    });

    it('still re-reads the order when the caller cannot accept one', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount(orderWith([line()]), { acceptOrder: undefined });
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(loadOrder).toHaveBeenCalledTimes(1);
    });
});

describe('line ids', () => {
    it('a product with no line gets a client id that the batch carries with its product', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([])));
        await mount(orderWith([]));
        await tap(lomo, 1);
        await tap(lomo, 1);
        await pass(ORDER_SYNC_DELAY_MS);

        const [[orderId, lines]] = saveDraftLines.mock.calls;
        expect(orderId).toBe('o1');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toEqual({ client_line_id: expect.stringMatching(/^[A-Za-z0-9._:-]{8,64}$/), product_id: 'p-b', quantity: 2 });
    });

    it('keeps the same client id for the same line across batches, so a replay never makes a second line', async () => {
        saveDraftLines.mockImplementation(async (orderId, lines) => answer(orderWith([
            line({ id: 'srv-1', client_line_id: lines[0].client_line_id, product_id: 'p-b', product_name: 'Lomo', quantity: lines[0].quantity, subtotal: lines[0].quantity * 10 }),
        ])));
        await mount(orderWith([]));
        await tap(lomo, 1);
        await pass(ORDER_SYNC_DELAY_MS);
        const firstId = saveDraftLines.mock.calls[0][1][0].client_line_id;

        // The server now has the line: the next tap goes to it, under the same client id.
        await tap(lomo, 1);
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines.mock.calls[1][1]).toEqual([{ client_line_id: firstId, quantity: 2 }]);
    });

    it('a tap made while the line is being created reuses the client id of that line', async () => {
        let release;
        saveDraftLines.mockImplementationOnce((orderId, lines) => new Promise((resolve) => {
            release = () => resolve(answer(orderWith([
                line({ id: 'srv-1', client_line_id: lines[0].client_line_id, product_id: 'p-b', quantity: 1, subtotal: 10 }),
            ])));
        }));
        saveDraftLines.mockImplementation(async (orderId, lines) => answer(orderWith([
            line({ id: 'srv-1', client_line_id: lines[0].client_line_id, product_id: 'p-b', quantity: lines[0].quantity, subtotal: lines[0].quantity * 10 }),
        ])));
        await mount(orderWith([]));
        await tap(lomo, 1);
        await pass(ORDER_SYNC_DELAY_MS);
        const firstId = saveDraftLines.mock.calls[0][1][0].client_line_id;
        // The create is in flight when the next two taps arrive.
        await tap(lomo, 1);
        await tap(lomo, 1);
        expect(quantityOf('p-b')).toBe(3);

        await act(async () => { release(); });
        await settle();
        expect(quantityOf('p-b')).toBe(3);
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(saveDraftLines.mock.calls[1][1][0]).toMatchObject({ client_line_id: firstId, quantity: 3 });
    });

    it('a product tapped down to zero and up again while its line is being created keeps the same line id', async () => {
        let release;
        saveDraftLines.mockImplementationOnce((orderId, lines) => new Promise((resolve) => {
            release = () => resolve(answer(orderWith([
                line({ id: 'srv-1', client_line_id: lines[0].client_line_id, product_id: 'p-b', quantity: 1, subtotal: 10 }),
            ])));
        }));
        saveDraftLines.mockImplementation(async (orderId, lines) => answer(orderWith([
            line({ id: 'srv-1', client_line_id: lines[0].client_line_id, product_id: 'p-b', quantity: lines[0].quantity, subtotal: lines[0].quantity * 10 }),
        ])));
        await mount(orderWith([]));
        await tap(lomo, 1);
        await pass(ORDER_SYNC_DELAY_MS);
        const firstId = saveDraftLines.mock.calls[0][1][0].client_line_id;

        // Down to zero and up again while the create is on its way: it is the same line, not a second one.
        await tap(lomo, -1);
        await tap(lomo, 1);
        await tap(lomo, 1);
        expect(quantityOf('p-b')).toBe(2);
        await act(async () => { release(); });
        await settle();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(saveDraftLines.mock.calls[1][1]).toEqual([{ client_line_id: firstId, product_id: 'p-b', quantity: 2 }]);
    });

    it('a line created before batches existed is addressed by its own id', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount(orderWith([line({ id: 'legacy' })]));
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(saveDraftLines.mock.calls[0][1]).toEqual([{ client_line_id: 'legacy', quantity: 3 }]);
    });

    it('a line created by a batch is addressed by its client id', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount(orderWith([line({ id: 'srv-1', client_line_id: 'client-1' })]));
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(saveDraftLines.mock.calls[0][1]).toEqual([{ client_line_id: 'client-1', quantity: 3 }]);
    });
});

describe('one request at a time', () => {
    it('taps made while a batch is in flight travel in the next one', async () => {
        let release;
        saveDraftLines.mockImplementationOnce(() => new Promise((resolve) => {
            release = () => resolve(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        }));
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 5, subtotal: 50 })])));
        await mount();
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);

        await tap();
        await tap();
        expect(quantityOf('p-a')).toBe(5);
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);

        await act(async () => { release(); });
        await settle();
        // The screen never dips back to 3 while the follow-up is waiting.
        expect(quantityOf('p-a')).toBe(5);
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(saveDraftLines.mock.calls[1][1]).toEqual([{ client_line_id: 'a', quantity: 5 }]);
    });
});

describe('the first product of an account', () => {
    it('creates the order at once and sends the line with the next batch', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ id: 'srv', client_line_id: 'x', quantity: 1, subtotal: 10 })])));
        await mount(null);

        await tap(sopa, 1);
        await settle();
        expect(ensureOrderId).toHaveBeenCalledTimes(1);
        expect(saveDraftLines).not.toHaveBeenCalled();
        // The screen already shows the unit on the empty account.
        expect(quantityOf('p-a')).toBe(1);

        await tap(sopa, 1);
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
        expect(saveDraftLines.mock.calls[0][0]).toBe('o1');
        expect(saveDraftLines.mock.calls[0][1]).toEqual([
            { client_line_id: expect.any(String), product_id: 'p-a', quantity: 2 },
        ]);
    });

    it('drops the taps quietly when the caller says there is no order', async () => {
        ensureOrderId = jest.fn(async () => null);
        await mount(null);
        await tap(sopa, 1);
        await settle();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(saveDraftLines).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(view.result.current.busy()).toBe(false);
        expect(view.result.current.order).toBeNull();
    });
});

describe('when the server says no', () => {
    it('puts a rejected line back to the confirmed quantity and reports it once, while the others apply', async () => {
        const confirmed = orderWith([
            line({ quantity: 2 }),
            line({ id: 'b', product_id: 'p-b', product_name: 'Lomo', unit_price: 30, quantity: 2, subtotal: 60 }),
        ]);
        saveDraftLines.mockResolvedValue(answer(
            { ...confirmed, items: [confirmed.items[0], { ...confirmed.items[1], quantity: 3, subtotal: 90 }] },
            [
                { client_line_id: 'a', result: 'rejected', code: 'not_draft', detail: 'Ese producto ya fue enviado a cocina. Anúlalo y vuelve a pedirlo.' },
                { client_line_id: 'b', result: 'applied', line_id: 'b' },
            ],
        ));
        await mount(confirmed);
        await tap(sopa, 1);
        await tap(lomo, 1);
        expect(quantityOf('p-a')).toBe(3);
        await pass(ORDER_SYNC_DELAY_MS);

        expect(onError).toHaveBeenCalledTimes(1);
        const [error, entry] = onError.mock.calls[0];
        expect(error.response.data.detail).toBe('Ese producto ya fue enviado a cocina. Anúlalo y vuelve a pedirlo.');
        expect(entry).toMatchObject({ lineId: 'a', quantity: 3 });
        expect(quantityOf('p-a')).toBe(2);
        expect(quantityOf('p-b')).toBe(3);
        expect(view.result.current.failures()).toBe(1);
    });

    it('puts everything back and reports once when the whole batch is refused', async () => {
        saveDraftLines.mockRejectedValue(httpError(400, 'No se puede modificar un pedido cerrado'));
        await mount();
        await tap();
        await tap();
        expect(quantityOf('p-a')).toBe(4);
        await pass(ORDER_SYNC_DELAY_MS);

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].response.data.detail).toBe('No se puede modificar un pedido cerrado');
        expect(quantityOf('p-a')).toBe(2);
        expect(view.result.current.busy()).toBe(false);

        // Still usable afterwards.
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
    });
});

describe('when the connection fails', () => {
    it('keeps the taps on screen and in the outbox, says so, and saves them when it can', async () => {
        saveDraftLines
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue(answer(orderWith([line({ quantity: 4, subtotal: 40 })])));
        await mount();
        await tap();
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);

        expect(onStalled).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        expect(quantityOf('p-a')).toBe(4);
        expect(view.result.current.pending()).toBe(true);
        expect(view.result.current.saveState).toBe('unsaved');

        await act(async () => { await view.result.current.flush(); });
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(view.result.current.pending()).toBe(false);
        expect(view.result.current.saveState).toBe('idle');
        expect(saveDraftLines.mock.calls[1][1]).toEqual([{ client_line_id: 'a', quantity: 4 }]);
    });

    it('does not skip a line whose first answer may have been lost, even if the taps net back to the old quantity', async () => {
        saveDraftLines
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue(answer(orderWith([line({ quantity: 2 })])));
        await mount();
        await tap(sopa, 1);
        await pass(ORDER_SYNC_DELAY_MS);
        expect(onStalled).toHaveBeenCalledTimes(1);

        // The server may have applied 3. The waiter takes one back: the wanted 2 must still be sent.
        await tap(sopa, -1);
        await act(async () => { await view.result.current.flush(); });
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(saveDraftLines.mock.calls[1][1]).toEqual([{ client_line_id: 'a', quantity: 2 }]);
    });

    it('retries by itself after a pause', async () => {
        saveDraftLines
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount();
        await tap();
        await pass(ORDER_SYNC_DELAY_MS);
        expect(saveDraftLines).toHaveBeenCalledTimes(1);

        await pass(4000);
        expect(saveDraftLines).toHaveBeenCalledTimes(2);
        expect(view.result.current.pending()).toBe(false);
    });
});

describe('what shows while saving', () => {
    it('is idle, then unsaved while the taps wait, then saving while the batch is on the wire, then idle', async () => {
        let release;
        saveDraftLines.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        }));
        await mount();
        expect(view.result.current.saveState).toBe('idle');

        await tap();
        expect(view.result.current.saveState).toBe('unsaved');
        await pass(ORDER_SYNC_DELAY_MS);
        expect(view.result.current.saveState).toBe('saving');
        expect(view.result.current.syncing).toBe(true);

        await act(async () => { release(); });
        await settle();
        expect(view.result.current.saveState).toBe('idle');
        expect(view.result.current.syncing).toBe(false);
    });
});

describe('the moments that save at once', () => {
    const waiting = async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount();
        await tap();
        expect(saveDraftLines).not.toHaveBeenCalled();
    };

    const setVisibility = (state) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
        document.dispatchEvent(new Event('visibilitychange'));
    };

    afterEach(() => { delete document.visibilityState; });

    it('the app going to the background', async () => {
        await waiting();
        await act(async () => { setVisibility('hidden'); });
        await settle();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
    });

    it('coming back to the foreground sends nothing by itself', async () => {
        await waiting();
        await act(async () => { setVisibility('visible'); });
        await settle();
        expect(saveDraftLines).not.toHaveBeenCalled();
    });

    it('the page being hidden or closed', async () => {
        await waiting();
        await act(async () => { window.dispatchEvent(new Event('pagehide')); });
        await settle();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
    });

    it('the connection coming back', async () => {
        await waiting();
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await settle();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
    });

    it('leaving the screen', async () => {
        await waiting();
        await view.unmount();
        view = null;
        await settle();
        expect(saveDraftLines).toHaveBeenCalledTimes(1);
    });

    it('nothing is sent for events when nothing is waiting', async () => {
        await mount();
        await act(async () => {
            setVisibility('hidden');
            window.dispatchEvent(new Event('pagehide'));
            window.dispatchEvent(new Event('online'));
        });
        await settle();
        expect(saveDraftLines).not.toHaveBeenCalled();
    });

    it('stops listening when the screen goes away', async () => {
        const add = jest.spyOn(window, 'addEventListener');
        const remove = jest.spyOn(window, 'removeEventListener');
        await mount();
        await view.unmount();
        view = null;

        ['online', 'pagehide'].forEach((type) => {
            const registered = add.mock.calls.filter(([name]) => name === type).map(([, handler]) => handler);
            expect(registered.length).toBeGreaterThan(0);
            registered.forEach((handler) => expect(remove).toHaveBeenCalledWith(type, handler));
        });
        add.mockRestore();
        remove.mockRestore();
    });
});

describe('closing the tab with taps on their way', () => {
    it('asks the browser to confirm only while something is waiting', async () => {
        saveDraftLines.mockResolvedValue(answer(orderWith([line({ quantity: 3, subtotal: 30 })])));
        await mount();
        const idle = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(idle);
        expect(idle.defaultPrevented).toBe(false);

        await tap();
        const busy = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(busy);
        expect(busy.defaultPrevented).toBe(true);
    });
});
