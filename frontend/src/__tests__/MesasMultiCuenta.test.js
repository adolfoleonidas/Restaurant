import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const mockTables = [];
const mockOrders = [];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (fetcher.toString().includes("api.get('/tables')")
        ? { data: mockTables, refetch: jest.fn() }
        : { data: mockOrders, refetch: jest.fn() }),
}));

const baseTable = (number, extra = {}) => ({
    id: `table-${number}`, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4,
    status: 'ocupada', active_attention_id: 'att-1', branch_id: 'branch-1', active_order: null, group: null, ...extra,
});

const order = (id, number, name, total) => ({
    id, order_number: number, table_id: 'table-1', status: 'en_preparacion', order_type: 'mesa',
    total, amount_paid: 0, source: 'staff', created_at: new Date().toISOString(),
    attention_id: 'att-1', attention_state: 'open',
    items: [{ id: `${id}-item`, product_name: name, quantity: 1, subtotal: total, status: 'pendiente' }],
});

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(el) { await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }

describe('multi-cuenta en el salón', () => {
    let container, root;
    beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });
    afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ''; });

    it('lista las cuentas de una mesa y cambia entre ellas', async () => {
        const o1 = order('order-1', 11, 'Ceviche', 30);
        const o2 = order('order-2', 12, 'Lomo', 20);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1, o2);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: o1 });
            if (url === '/orders/order-2') return Promise.resolve({ data: o2 });
            return Promise.resolve({ data: [o1, o2] }); // GET /orders?table_id=...
        });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuentas"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-11"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-12"]')).not.toBeNull();
        expect(sheet.textContent).toContain('Ceviche');

        await click(sheet.querySelector('[data-testid="mesa-sheet-cuenta-12"]'));
        // El detalle muestra solo los ítems de la cuenta elegida…
        const items = sheet.querySelector('[data-testid="mesa-sheet-items"]');
        expect(items.textContent).toContain('Lomo');
        expect(items.textContent).not.toContain('Ceviche');
        // …y el resumen de la mesa agrega lo de todas las cuentas (se despliega
        // desde la barra del recibo).
        await click(sheet.querySelector('[data-testid="mesa-sheet-resumen-toggle"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-resumen"]').textContent).toContain('Ceviche');
    });

    it('muestra el alias de cada cuenta para ubicarla y sumarle lo suyo', async () => {
        const o1 = { ...order('order-1', 11, 'Ceviche', 30), customer_name: 'Juan' };
        const o2 = order('order-2', 12, 'Lomo', 20);
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

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        const tabs = sheet.querySelector('[data-testid="mesa-sheet-cuentas"]');
        expect(tabs.textContent).toContain('Juan');
        expect(tabs.textContent).toContain('#12'); // la que no tiene alias cae al número
        // La carta dice a quién le está agregando.
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]').textContent).toContain('Agregar a Juan');
    });

    it('no pide crear cuentas: la persona aparece recién al enviar su pedido', async () => {
        const o1 = order('order-1', 11, 'Ceviche', 30);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) return Promise.resolve({ data: o1 });
            return Promise.resolve({ data: [o1] });
        });
        api.post.mockResolvedValue({ data: o1 });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        // Ya no hay un botón de "abrir cuenta": el mozo sólo escribe el alias.
        expect(sheet.querySelector('[data-testid="mesa-sheet-nueva-cuenta"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-alias"]')).not.toBeNull();
    });

    it('fusiona las demás cuentas dentro de la seleccionada', async () => {
        const o1 = order('order-1', 11, 'Ceviche', 30);
        const o2 = order('order-2', 12, 'Lomo', 20);
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1, o2);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: o1 });
            if (url === '/orders/order-2') return Promise.resolve({ data: o2 });
            return Promise.resolve({ data: [o1, o2] });
        });
        api.post.mockResolvedValue({ data: o1 });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        await click(sheet.querySelector('[data-testid="mesa-sheet-fusionar-cuentas"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/merge', { source_order_id: 'order-2' });
    });

    it('mueve una cuenta a una mesa libre', async () => {
        const o1 = order('order-1', 11, 'Ceviche', 30);
        const o2 = order('order-2', 12, 'Lomo', 20);
        mockTables.splice(0, mockTables.length,
            baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }),
            baseTable(3, { status: 'disponible', active_attention_id: null, active_order: null }),
        );
        mockOrders.splice(0, mockOrders.length, o1, o2);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: o1 });
            if (url === '/orders/order-2') return Promise.resolve({ data: o2 });
            return Promise.resolve({ data: [o1, o2] });
        });
        api.post.mockResolvedValue({ data: o1 });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        await click(sheet.querySelector('[data-testid="mesa-sheet-mover-cuenta"]'));
        const dialog = document.body.querySelector('[data-testid="mover-cuenta"]');
        expect(dialog).not.toBeNull();
        await click(dialog.querySelector('[data-testid="mover-cuenta-mesa-3"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/move', { target_table_id: 'table-3' });
    });

    it('divide la cuenta en N partes', async () => {
        const o1 = {
            ...order('order-1', 11, 'Lomo', 30),
            items: [
                { id: 'i1', product_name: 'Lomo', quantity: 1, subtotal: 20, status: 'pendiente' },
                { id: 'i2', product_name: 'Agua', quantity: 1, subtotal: 10, status: 'pendiente' },
            ],
        };
        mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) return Promise.resolve({ data: o1 });
            return Promise.resolve({ data: [o1] });
        });
        api.post.mockResolvedValue({ data: o1 });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        await click(sheet.querySelector('[data-testid="mesa-sheet-dividir-2"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/split', { parts: 2 });
    });
});
