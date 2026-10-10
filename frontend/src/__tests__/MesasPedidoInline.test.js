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

const item = (id, name, qty, price, productId = 'prod-1') => ({
    id, product_id: productId, product_name: name, quantity: qty, subtotal: qty * price, status: 'pendiente',
});

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

    it('agrega el producto a la cuenta que se está viendo sin crear otra', async () => {
        const existing = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 1, 38)], 38);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, existing);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: existing });
            return Promise.resolve({ data: [existing] });
        });
        api.post.mockResolvedValue({ data: existing });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-producto-prod-1"]'));

        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/items', [{ product_id: 'prod-1', quantity: 1 }]);
    });

    it('el pedido de otra persona abre una cuenta nueva de la misma visita', async () => {
        const existing = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 1, 38)], 38);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, existing);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: existing });
            return Promise.resolve({ data: [existing] });
        });
        const nueva = { ...order('order-9', 13, 'nuevo', []), customer_name: null };
        api.post.mockImplementation((url) => (
            url === '/orders' ? Promise.resolve({ data: nueva }) : Promise.resolve({ data: nueva })
        ));
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        // La mesa ya tiene visita: la siguiente cuenta se inicia desde el área
        // visible de cuentas/personas.
        await click(document.body.querySelector('[data-testid="mesa-sheet-agregar-persona"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-producto-prod-1"]'));

        expect(api.post).toHaveBeenCalledWith('/orders', {
            table_id: 'table-1', order_type: 'mesa', new_account: true,
        });
    });

    it('envía a cocina una cuenta en borrador', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Ceviche', 1, 38)], 38);
        draft.items[0].status = 'borrador';
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'nuevo' } }));
        mockOrders.splice(0, mockOrders.length, draft);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: draft });
            return Promise.resolve({ data: [draft] });
        });
        api.post.mockResolvedValue({ data: draft });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        // El pedido a medio armar es el que la mesa retoma al abrirse.
        const button = document.body.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(button).not.toBeNull();
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(button);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
    });

    it('guarda el alias al enviar el pedido, sin botón de guardar', async () => {
        const existing = order('order-1', 11, 'nuevo', [item('i1', 'Ceviche', 1, 38)], 38);
        existing.items[0].status = 'borrador';
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'nuevo' } }));
        mockOrders.splice(0, mockOrders.length, existing);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: existing });
            return Promise.resolve({ data: [existing] });
        });
        api.patch.mockResolvedValue({ data: existing });
        api.post.mockResolvedValue({ data: { ...existing, customer_name: 'Juan' } });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        // S10: el alias se edita desde el ✎ de la franja "Para {persona}".
        await click(document.body.querySelector('[data-testid="mesa-sheet-persona-renombrar"]'));
        const input = document.body.querySelector('[data-testid="mesa-sheet-persona-nombre"]');
        expect(input).not.toBeNull();
        // No hay botón de guardar: el alias viaja con la comanda.
        expect(document.body.querySelector('[data-testid="mesa-sheet-alias-guardar"]')).toBeNull();
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'Juan');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(document.body.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/alias', { alias: 'Juan', shared: false });
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
    });

    it('muestra la cantidad ya pedida por producto y el resumen de la cuenta', async () => {
        const existing = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 2, 38)], 76);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, existing);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: existing });
            return Promise.resolve({ data: [existing] });
        });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        // S10: sin franja de personas, la cuenta de la mesa ya es la activa.

        const badge = document.body.querySelector('[data-testid="mesa-sheet-producto-cantidad-prod-1"]');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('2');
        expect(document.body.querySelector('[data-testid="mesa-sheet-pedido-resumen"]').textContent).toContain('76.00');
    });

    it('resume los platos de todas las cuentas de la mesa', async () => {
        const o1 = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 2, 38)], 76);
        const o2 = order('order-2', 12, 'en_preparacion', [item('i2', 'Ceviche', 1, 38), item('i3', 'Chicha', 2, 10)], 58);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1, o2);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: o1 });
            if (url === '/orders/order-2') return Promise.resolve({ data: o2 });
            return Promise.resolve({ data: [o1, o2] });
        });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        // S10b: el detalle agrupado se abre como "Resumen de mesa / Recibo" desde
        // ⋯ Más; el cuerpo del detalle ya no muestra el bloque plegable.
        await click(document.body.querySelector('[data-testid="mesa-sheet-mas"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-ver-resumen"]'));
        const summary = document.body.querySelector('[data-testid="mesa-sheet-resumen"]');
        expect(summary).not.toBeNull();
        expect(summary.textContent).toContain('134.00');
        await click(document.body.querySelector('[data-testid="mesa-sheet-resumen-toggle"]'));
        expect(summary.textContent).toContain('3× Ceviche');
        expect(summary.textContent).toContain('2× Chicha');
    });
});
