/**
 * "Nuevo pedido" as a page: the cart is built locally and "Enviar a cocina" creates the order and
 * sends it. The create carries a request id, so pressing send again after a lost answer asks for the
 * same order instead of making a second one.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import PedidoNuevo from '@/pages/PedidoNuevo';
import { createOrder, sendOrderToKitchen } from '@/lib/api/orders';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams('tipo=llevar')],
}));
jest.mock('@/contexts/NotifyContext', () => ({ useRealtimeGeneration: () => 0 }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/api/orders', () => ({ createOrder: jest.fn(), sendOrderToKitchen: jest.fn() }));
jest.mock('@/lib/api/categories', () => ({ listCategories: jest.fn() }));
jest.mock('@/lib/api/products', () => ({ listProducts: jest.fn() }));
jest.mock('@/lib/api/tables', () => ({ listTables: jest.fn(), releaseTable: jest.fn() }));

const mockProducts = [
    { id: 'p1', name: 'Ceviche', price: 38, is_available: true },
    { id: 'p2', name: 'Lomo', price: 30, is_available: true },
];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => ({ data: fetcher.toString().includes('listProducts') ? mockProducts : [] }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} });
const refusal = (detail) => ({ response: { status: 400, data: { detail } } });
const byId = (id) => document.body.querySelector(`[data-testid="${id}"]`);

async function click(element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

// The backend as far as a create goes: one order per request id, however often it is asked.
function backend({ lostAnswers = 0 } = {}) {
    const made = new Map();
    let lost = lostAnswers;
    createOrder.mockImplementation(async (payload) => {
        if (!made.has(payload.request_id)) made.set(payload.request_id, { id: `order-${made.size + 1}` });
        if (lost > 0) {
            lost -= 1;
            throw networkError();
        }
        return { data: made.get(payload.request_id) };
    });
    return made;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/;
const requestIds = () => createOrder.mock.calls.map(([payload]) => payload.request_id);
// Both tries carry an id the server accepts, and it is the same one.
const expectTheSameRequestId = () => {
    const [first, second] = requestIds();
    expect(first).toMatch(REQUEST_ID);
    expect(second).toBe(first);
};

describe('PedidoNuevo: the request id of the create', () => {
    let root;

    beforeEach(async () => {
        [createOrder, sendOrderToKitchen, mockNavigate, toast.error, toast.success].forEach((fn) => fn.mockReset());
        sendOrderToKitchen.mockResolvedValue({ data: {} });
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<PedidoNuevo />));
        await click(byId('producto-add-p1'));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        document.body.innerHTML = '';
    });

    it('sends the order with a request id and goes back to the floor', async () => {
        const made = backend();

        await click(byId('pedido-enviar-cocina'));

        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(createOrder).toHaveBeenCalledWith({
            order_type: 'llevar',
            items: [{ product_id: 'p1', quantity: 1, notes: null }],
            notes: null,
            request_id: expect.stringMatching(REQUEST_ID),
        });
        expect(sendOrderToKitchen).toHaveBeenCalledWith('order-1');
        expect(made.size).toBe(1);
        expect(mockNavigate).toHaveBeenCalledWith('/salon', { replace: true });
    });

    it('pressing send again after a lost answer asks with the same request id: one order, sent once', async () => {
        const made = backend({ lostAnswers: 1 });

        await click(byId('pedido-enviar-cocina'));
        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(sendOrderToKitchen).not.toHaveBeenCalled();

        await click(byId('pedido-enviar-cocina'));
        expect(createOrder).toHaveBeenCalledTimes(2);
        expectTheSameRequestId();
        expect(made.size).toBe(1);
        expect(sendOrderToKitchen).toHaveBeenCalledTimes(1);
        expect(sendOrderToKitchen).toHaveBeenCalledWith('order-1');
        expect(mockNavigate).toHaveBeenCalledWith('/salon', { replace: true });
    });

    it('an order that was made but could not be sent to the kitchen is not made a second time', async () => {
        const made = backend();
        sendOrderToKitchen.mockRejectedValueOnce(networkError());

        await click(byId('pedido-enviar-cocina'));
        expect(mockNavigate).not.toHaveBeenCalled();
        await click(byId('pedido-enviar-cocina'));

        expect(createOrder).toHaveBeenCalledTimes(2);
        expectTheSameRequestId();
        expect(made.size).toBe(1);
        expect(sendOrderToKitchen).toHaveBeenCalledTimes(2);
        expect(sendOrderToKitchen.mock.calls.map(([id]) => id)).toEqual(['order-1', 'order-1']);
        expect(mockNavigate).toHaveBeenCalledWith('/salon', { replace: true });
    });

    it('changing the cart after a failed try is another create, with another request id', async () => {
        const made = backend({ lostAnswers: 1 });

        await click(byId('pedido-enviar-cocina'));
        await click(document.body.querySelector('[aria-label="Agregar una unidad de Ceviche"]'));
        await click(byId('pedido-enviar-cocina'));

        expect(createOrder).toHaveBeenCalledTimes(2);
        expect(createOrder.mock.calls[1][0].items).toEqual([{ product_id: 'p1', quantity: 2, notes: null }]);
        expect(requestIds()[0]).toMatch(REQUEST_ID);
        expect(requestIds()[1]).toMatch(REQUEST_ID);
        expect(requestIds()[1]).not.toBe(requestIds()[0]);
        expect(made.size).toBe(2);
    });

    it('a create the server refused leaves its request id behind', async () => {
        backend();
        createOrder.mockRejectedValueOnce(refusal('Producto agotado: Ceviche'));

        await click(byId('pedido-enviar-cocina'));
        expect(toast.error).toHaveBeenCalledWith('Producto agotado: Ceviche');
        await click(byId('pedido-enviar-cocina'));

        expect(createOrder).toHaveBeenCalledTimes(2);
        expect(requestIds()[0]).toMatch(REQUEST_ID);
        expect(requestIds()[1]).toMatch(REQUEST_ID);
        expect(requestIds()[1]).not.toBe(requestIds()[0]);
        expect(mockNavigate).toHaveBeenCalledWith('/salon', { replace: true });
    });
});
