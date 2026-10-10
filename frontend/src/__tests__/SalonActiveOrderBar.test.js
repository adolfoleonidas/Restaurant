import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

/**
 * Cobertura de las dos piezas que el salón toma del concepto "Salón Mozo":
 * el mini-reproductor del pedido activo. Los contratos de
 * las suites existentes (`mesa-card-*`, `mesa-sheet-*`) no se tocan: esta suite
 * solo añade los testids nuevos (`salon-mini`).
 */

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
// Mozo de sala con atención y cobro: es el perfil que ve las dos acciones de
// la banda ("Servir" y "Cobrar"). Las funciones van explícitas para que la
// suite no dependa de los valores por rol.
const mockUser = { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'mozo', functions: ['atencion', 'cobro'] };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const mockTables = [];
const mockOrders = [];
// Cada lectura devuelve una copia nueva: el salón memoriza sus derivados por
// referencia, así que devolver siempre el mismo array dejaría a la pantalla con
// los datos del caso anterior.
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = fetcher.toString();
        if (src.includes("api.get('/tables')")) return { data: mockTables.slice(), refetch: jest.fn() };
        if (src.includes("api.get('/orders'")) return { data: mockOrders.slice(), refetch: jest.fn() };
        return { data: [], refetch: jest.fn() };
    },
}));

const item = (id, name, qty, subtotal, status) => ({ id, product_name: name, quantity: qty, subtotal, status });

const order = (overrides = {}) => ({
    id: 'order-1', order_number: 11, table_id: 'table-1', status: 'en_preparacion',
    order_type: 'mesa', total: 30, amount_paid: 0, source: 'staff',
    created_at: new Date().toISOString(), attention_id: 'att-1', attention_state: 'open',
    items: [item('i1', 'Ceviche', 1, 30, 'pendiente')],
    ...overrides,
});

const table = (overrides = {}) => ({
    id: 'table-1', number: 1, name: 'Mesa 1', area: 'Salón', capacity: 4, status: 'ocupada',
    active_attention_id: 'att-1', branch_id: 'branch-1', active_order: null, group: null,
    ...overrides,
});

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(el) { await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }

describe('mini-reproductor del pedido activo', () => {
    let container; let root;

    beforeEach(() => {
        window.confirm = jest.fn().mockReturnValue(false);
        api.get.mockReset();
        api.post.mockReset();
        api.delete.mockReset();
        mockTables.splice(0, mockTables.length);
        mockOrders.splice(0, mockOrders.length);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    it('cancelar la salida del compositor conserva los borradores y no crea una acción mini', async () => {
        // S14: la acción solo ofrece "Enviar a cocina" cuando hay borradores
        // reales; con lo ya enviado muestra el estado y ofrece "Agregar".
        const o1 = order({ items: [item('i1', 'Ceviche', 1, 30, 'borrador')] });
        mockTables.splice(0, mockTables.length, table({ active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) return Promise.resolve({ data: o1 });
            return Promise.resolve({ data: [o1] });
        });

        ({ container, root } = await renderPage());
        // Sin hoja abierta no hay pedido activo que seguir.
        expect(container.querySelector('[data-testid="salon-mini"]')).toBeNull();

        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        // Exiting the composer is blocked until the draft is explicitly discarded.
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(window.confirm).toHaveBeenCalled();
        expect(container.querySelector('[data-testid="salon-mini"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        expect(api.delete).not.toHaveBeenCalled();
    });

    it('no habilita el mini con borradores sin descartar', async () => {
        const o1 = order({ items: [item('i1', 'Ceviche', 2, 60, 'borrador')], total: 60 });
        mockTables.splice(0, mockTables.length, table({ active_order: { id: 'order-1', status: 'en_preparacion' } }));
        mockOrders.splice(0, mockOrders.length, o1);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) return Promise.resolve({ data: o1 });
            return Promise.resolve({ data: [o1] });
        });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(container.querySelector('[data-testid="salon-mini"]')).toBeNull();
        expect(window.confirm).toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
    });

    it('sirve desde la barra cuando hay platos listos', async () => {
        const o1 = order({ items: [item('i1', 'Ceviche', 1, 30, 'listo')] });
        mockTables.splice(0, mockTables.length, table({ active_order: { id: 'order-1', status: 'listo' } }));
        mockOrders.splice(0, mockOrders.length, o1);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) return Promise.resolve({ data: o1 });
            return Promise.resolve({ data: [o1] });
        });
        api.post.mockResolvedValue({ data: {} });

        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));

        const accion = container.querySelector('[data-testid="salon-mini-accion"]');
        expect(accion.textContent).toBe('Servir');
        await click(accion);
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/serve');
    });

    it('ya no pinta la banda "Ahora": el estado se lee en las tarjetas', async () => {
        const ready = order({
            id: 'order-ready', order_number: 21, table_id: 'table-1', status: 'listo',
            items: [item('i1', 'Ceviche', 1, 30, 'listo')],
        });
        const bill = order({
            id: 'order-bill', order_number: 22, table_id: 'table-2', status: 'pendiente_pago',
            total: 45, attention_id: 'att-2',
            items: [item('i2', 'Lomo', 1, 45, 'entregado')],
        });
        mockTables.splice(0, mockTables.length,
            table({ id: 'table-1', number: 1, status: 'ocupada', active_order: { id: 'order-ready', status: 'listo' } }),
            table({ id: 'table-2', number: 2, status: 'esperando_pago', active_attention_id: 'att-2', active_order: { id: 'order-bill', status: 'pendiente_pago' } }),
        );
        mockOrders.splice(0, mockOrders.length, ready, bill);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [ready, bill] });
        });

        ({ container, root } = await renderPage());
        expect(container.querySelector('[data-testid="salon-ahora"]')).toBeNull();
        // Lo que la banda repetía ya está en las tarjetas: estado, monto y acción.
        expect(container.textContent).toContain('Listo');
        expect(container.textContent).toContain('Debe S/ 30.00');
        expect(container.textContent).toContain('Debe S/ 45.00');
        expect(container.querySelector('[data-testid="mesa-card-1"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-2"]')).not.toBeNull();
    });
});

