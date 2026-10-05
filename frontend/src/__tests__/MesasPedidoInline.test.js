import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
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
        if (src.includes("api.get('/tables')")) return { data: mockTables, refetch: jest.fn() };
        if (src.includes("api.get('/products')")) return { data: mockProducts, refetch: jest.fn() };
        if (src.includes("api.get('/categories')")) return { data: [], refetch: jest.fn() };
        return { data: mockOrders, refetch: jest.fn() };
    },
}));

const baseTable = (number, extra = {}) => ({
    id: `table-${number}`, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4,
    status: 'ocupada', active_attention_id: 'att-1', branch_id: 'branch-1', active_order: null, group: null, ...extra,
});

const order = (id, number, status, items, total) => ({
    id, order_number: number, table_id: 'table-1', status, order_type: 'mesa',
    total, amount_paid: 0, source: 'staff', created_at: new Date().toISOString(),
    attention_id: 'att-1', attention_state: 'open', items,
});

const item = (id, name, qty, price) => ({ id, product_name: name, quantity: qty, subtotal: qty * price, status: 'pendiente' });

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(el) { await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }

describe('pedido inline en el salón', () => {
    let container;
    let root;

    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
        mockProducts.splice(0, mockProducts.length, { id: 'prod-1', name: 'Ceviche', price: 38, is_available: true, category_id: 'c1' });
        mockOrders.splice(0, mockOrders.length);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    it('crea la cuenta recién al agregar el primer producto', async () => {
        mockTables.splice(0, mockTables.length, baseTable(1, { status: 'disponible', active_attention_id: null, active_order: null }));
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-new') return Promise.resolve({ data: order('order-new', 30, 'nuevo', [item('i1', 'Ceviche', 1, 38)], 38) });
            return Promise.resolve({ data: [] });
        });
        api.post.mockImplementation((url) => {
            if (url === '/orders') return Promise.resolve({ data: order('order-new', 30, 'nuevo', [], 0) });
            return Promise.resolve({ data: {} });
        });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-prod-1"]'));

        expect(api.post).toHaveBeenCalledWith('/orders', { table_id: 'table-1', order_type: 'mesa' });
        expect(api.post).toHaveBeenCalledWith('/orders/order-new/items', [{ product_id: 'prod-1', quantity: 1 }]);
    });

    it('agrega el producto a la cuenta existente sin crear otra', async () => {
        const existing = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 1, 38)], 38);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, existing);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: existing });
            return Promise.resolve({ data: [existing] });
        });
        api.post.mockResolvedValue({ data: {} });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-producto-prod-1"]'));

        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/items', [{ product_id: 'prod-1', quantity: 1 }]);
    });

    it('envía a cocina una cuenta en borrador', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Ceviche', 1, 38)], 38);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'nuevo' } }));
        mockOrders.splice(0, mockOrders.length, draft);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: draft });
            return Promise.resolve({ data: [draft] });
        });
        api.post.mockResolvedValue({ data: {} });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const button = document.body.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(button).not.toBeNull();
        await click(button);
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
    });
});
