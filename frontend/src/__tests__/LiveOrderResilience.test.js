/**
 * Un tropiezo de red no puede borrar el pedido del cliente.
 *
 * El sondeo devolvía `null` ante CUALQUIER error, así que un timeout, un 429 o un
 * 500 vaciaba el pedido activo y `addProduct` quedaba mudo (`if (!order) return`).
 * Solo un 404 significa «el pedido ya no existe»; lo demás conserva lo último leído.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveOrderProvider, useLiveOrder } from '@/contexts/LiveOrderContext';
import { addPublicOrderItem, getPublicOrder } from '@/lib/api/public';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/public', () => ({
    getPublicOrder: jest.fn(),
    addPublicOrderItem: jest.fn(),
    updatePublicOrderItem: jest.fn(),
    removePublicOrderItem: jest.fn(),
}));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));

const KEY = 'public_last_order_v1';
const ORDER = { tracking_code: 'ABC123', status: 'pendiente', items: [{ id: 'l1', product_id: 'p1', quantity: 1, status: 'pendiente' }] };
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

let live;
let view;
function Probe() {
    live = useLiveOrder();
    return null;
}

async function mount() {
    localStorage.setItem(KEY, JSON.stringify({ tracking_code: 'ABC123' }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    view = { host, root };
    await act(async () => root.render(<LiveOrderProvider><Probe /></LiveOrderProvider>));
    await flush();
}

afterEach(async () => {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
    localStorage.clear();
    jest.clearAllMocks();
});

describe('LiveOrderContext polling errors', () => {
    it.each([
        ['a timeout', { code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' }],
        ['a 429', { response: { status: 429, data: {} } }],
        ['a 500', { response: { status: 500, data: {} } }],
        ['a network error', { message: 'Network Error', request: {} }],
    ])('keeps the active order when the poll fails with %s', async (_label, failure) => {
        getPublicOrder.mockResolvedValueOnce({ data: ORDER });
        await mount();
        expect(live.order).toEqual(ORDER);
        expect(live.isActive).toBe(true);

        getPublicOrder.mockRejectedValueOnce(failure);
        await act(async () => { await live.refetch(); });
        await flush();

        expect(live.order).toEqual(ORDER);
        expect(live.isActive).toBe(true);
        expect(JSON.parse(localStorage.getItem(KEY)).tracking_code).toBe('ABC123');
    });

    it('addProduct still works after a failed poll', async () => {
        getPublicOrder.mockResolvedValueOnce({ data: ORDER });
        await mount();
        getPublicOrder.mockRejectedValueOnce({ response: { status: 429, data: {} } });
        await act(async () => { await live.refetch(); });
        addPublicOrderItem.mockResolvedValue({ data: {} });
        getPublicOrder.mockResolvedValue({ data: ORDER });

        await act(async () => { await live.addProduct({ id: 'p2' }, 1); });

        expect(addPublicOrderItem).toHaveBeenCalledWith('ABC123', { items: [{ product_id: 'p2', quantity: 1 }] });
    });

    it('drops the order only when the server says it is gone (404)', async () => {
        getPublicOrder.mockResolvedValueOnce({ data: ORDER });
        await mount();
        expect(live.order).toEqual(ORDER);

        getPublicOrder.mockRejectedValueOnce({ response: { status: 404, data: {} } });
        await act(async () => { await live.refetch(); });
        await flush();

        expect(live.order).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
    });
});
