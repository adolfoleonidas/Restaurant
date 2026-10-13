import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { ORDER_SYNC_DELAY_MS } from '@/lib/lineSyncQueue';
import { toast } from 'sonner';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const mockTables = [];
const mockOrders = [];
const mockProducts = [];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = fetcher.toString();
        if (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(src)) return { data: mockTables, refetch: jest.fn() };
        if (src.includes('listProducts')) return { data: mockProducts, refetch: jest.fn() };
        if (src.includes('listCategories')) return { data: [], refetch: jest.fn() };
        return { data: mockOrders, refetch: jest.fn() };
    },
}));

const item = () => ({ id: 'i1', product_id: 'prod-1', product_name: 'Ceviche', quantity: 1, subtotal: 38, status: 'pendiente' });
const createdOrder = (extra = {}) => ({
    id: 'order-9', order_number: 40, order_type: 'llevar', status: 'nuevo',
    total: 38, amount_paid: 0, items: [item()], ...extra,
});

async function renderSalon() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Salon />));
    return { host, root };
}

async function click(el) {
    await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

// The waiter pauses: taps are saved in one batch once the window runs out (BS-02).
async function savePendingTaps() {
    await act(async () => {
        jest.advanceTimersByTime(ORDER_SYNC_DELAY_MS);
        for (let i = 0; i < 30; i += 1) await Promise.resolve();
    });
}

async function openComposer(host, type) {
    await click(host.querySelector('[data-testid="salon-nuevo-pedido"]'));
    if (type && type !== 'mesa') await click(document.body.querySelector(`[data-testid="nuevo-pedido-tipo-${type}"]`));
}

describe('nuevo pedido sin mesa', () => {
    let host;
    let root;

    beforeEach(() => {
        jest.useFakeTimers();
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.put.mockReset();
        api.delete.mockReset();
        toast.error.mockClear();
        toast.success.mockClear();
        mockTables.splice(0, mockTables.length);
        mockOrders.splice(0, mockOrders.length);
        mockProducts.splice(0, mockProducts.length, { id: 'prod-1', name: 'Ceviche', price: 38, is_available: true });
        api.get.mockImplementation((url) => {
            if (url === '/orders/order-9') return Promise.resolve({ data: createdOrder() });
            return Promise.resolve({ data: [] });
        });
        api.post.mockImplementation((url) => {
            if (url === '/orders') return Promise.resolve({ data: createdOrder({ items: [], total: 0 }) });
            return Promise.resolve({ data: {} });
        });
        api.put.mockImplementation(() => Promise.resolve({ data: createdOrder() }));
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
        jest.useRealTimers();
    });

    it('crea el pedido para llevar recién con el primer producto', async () => {
        ({ host, root } = await renderSalon());
        await openComposer(host, 'llevar');

        expect(document.body.querySelector('[data-testid="nuevo-pedido-sheet"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        const customerDetails = document.body.querySelector('[data-testid="nuevo-pedido-datos-opcionales"]');
        expect(customerDetails.open).toBe(false);
        await click(customerDetails.querySelector('summary'));
        expect(customerDetails.open).toBe(true);

        await click(document.body.querySelector('[data-testid="nuevo-pedido-producto-prod-1"]'));

        // The order exists as soon as the first product is tapped; its line follows in the batch.
        expect(api.post).toHaveBeenCalledWith('/orders', { order_type: 'llevar' });
        expect(api.put).not.toHaveBeenCalled();
        await savePendingTaps();
        expect(api.put).toHaveBeenCalledWith(
            '/orders/order-9/draft-lines',
            { lines: [{ client_line_id: expect.any(String), product_id: 'prod-1', quantity: 1 }] },
            { timeout: 15000 }
        );
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-9/items', expect.anything());
    });

    it('UX-14 quick taps before the order exists create it once and keep every unit', async () => {
        const server = { items: [] };
        let releaseCreate;
        api.post.mockImplementation((url) => {
            if (url === '/orders') {
                return new Promise((resolve) => { releaseCreate = () => resolve({ data: createdOrder({ items: [], total: 0 }) }); });
            }
            return Promise.resolve({ data: {} });
        });
        api.put.mockImplementation((url, body) => {
            body.lines.forEach((line) => {
                const existing = server.items.find((i) => i.client_line_id === line.client_line_id);
                if (existing) {
                    existing.quantity = line.quantity;
                    existing.subtotal = 38 * line.quantity;
                } else {
                    server.items.push({
                        id: `i${server.items.length + 1}`, client_line_id: line.client_line_id, product_id: line.product_id, product_name: 'Ceviche', quantity: line.quantity, unit_price: 38, subtotal: 38 * line.quantity, status: 'borrador', notes: null,
                    });
                }
            });
            return Promise.resolve({
                data: createdOrder({
                    items: server.items.map((i) => ({ ...i })),
                    total: server.items.reduce((sum, i) => sum + i.subtotal, 0),
                    line_results: body.lines.map((line) => ({ client_line_id: line.client_line_id, result: 'applied' })),
                }),
            });
        });
        api.get.mockImplementation((url) => (url === '/orders/order-9'
            ? Promise.resolve({ data: createdOrder({ items: server.items.map((i) => ({ ...i })), total: server.items.reduce((sum, i) => sum + i.subtotal, 0) }) })
            : Promise.resolve({ data: [] })));
        ({ host, root } = await renderSalon());
        await openComposer(host, 'llevar');

        const card = () => document.body.querySelector('[data-testid="nuevo-pedido-producto-nombre-prod-1"]');
        const qty = () => document.body.querySelector('[data-testid="nuevo-pedido-producto-cantidad-prod-1"]').textContent;
        await click(card());
        await click(card());
        await click(card());
        // The screen follows the taps while the order is still being created.
        expect(qty()).toBe('3');
        expect(card().disabled).toBe(false);

        await act(async () => releaseCreate());
        await savePendingTaps();
        expect(api.post.mock.calls.filter(([url]) => url === '/orders')).toHaveLength(1);
        // Three taps, one request, one line with the net quantity.
        expect(api.put).toHaveBeenCalledTimes(1);
        expect(server.items).toHaveLength(1);
        expect(server.items[0].quantity).toBe(3);
        expect(qty()).toBe('3');
    });

    it('exige la dirección antes de crear un envío', async () => {
        ({ host, root } = await renderSalon());
        await openComposer(host, 'delivery');

        expect(document.body.querySelector('[data-testid="nuevo-pedido-direccion"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="nuevo-pedido-datos-opcionales"]').open).toBe(false);
        await click(document.body.querySelector('[data-testid="nuevo-pedido-producto-prod-1"]'));

        expect(api.post).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Falta la dirección del envío');
    });

    it('BS-02 closing the sheet saves what was tapped at once, in the order that was created, and starts the next one clean', async () => {
        ({ host, root } = await renderSalon());
        await openComposer(host, 'llevar');
        await click(document.body.querySelector('[data-testid="nuevo-pedido-producto-prod-1"]'));
        await click(document.body.querySelector('[data-testid="nuevo-pedido-producto-prod-1"]'));
        expect(api.put).not.toHaveBeenCalled();

        // Escape closes the sheet: no pause is waited for.
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
        expect(document.body.querySelector('[data-testid="nuevo-pedido-sheet"]')).toBeNull();
        expect(api.put).toHaveBeenCalledTimes(1);
        expect(api.put).toHaveBeenCalledWith(
            '/orders/order-9/draft-lines',
            { lines: [{ client_line_id: expect.any(String), product_id: 'prod-1', quantity: 2 }] },
            { timeout: 15000 }
        );

        // The answer of that batch must not bring the old order back into the next sheet.
        await openComposer(host, 'llevar');
        const qty = document.body.querySelector('[data-testid="nuevo-pedido-producto-cantidad-prod-1"]');
        expect(qty.textContent).toBe('0');
    });

    it('envía a cocina el pedido sin mesa', async () => {
        ({ host, root } = await renderSalon());
        await openComposer(host, 'recojo');
        await click(document.body.querySelector('[data-testid="nuevo-pedido-producto-prod-1"]'));

        const send = document.body.querySelector('[data-testid="nuevo-pedido-enviar-cocina"]');
        expect(send).not.toBeNull();
        // Sending does not wait for the pause: it saves the waiting taps right away, then sends.
        await click(send);

        expect(api.put).toHaveBeenCalledTimes(1);
        expect(api.post).toHaveBeenCalledWith('/orders/order-9/send-to-kitchen');
        expect(api.put.mock.invocationCallOrder[0]).toBeLessThan(
            api.post.mock.invocationCallOrder[api.post.mock.calls.findIndex(([url]) => url === '/orders/order-9/send-to-kitchen')]
        );
        expect(toast.success).toHaveBeenCalledWith('Enviado a cocina');
    });
});
