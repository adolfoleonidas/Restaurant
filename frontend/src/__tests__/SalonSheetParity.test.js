/**
 * Paridad de la hoja de mesa con el prototipo final (Slice 2):
 * - S2-1: resumen Consumido / Pagado / Pendiente con los saldos de la mesa.
 * - S2-2: botón Cobrar S/ X con el pendiente de la cuenta activa.
 * - S2-3: ✎ para renombrar el alias de cada persona de la franja.
 *
 * Sigue el patrón de mocks de MesasPersonasPedido.test.js: `usePolling`
 * devuelve filas mutables y `api.get` resuelve cuentas por id.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

const mockNavigate = jest.fn();
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
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

const item = (id, name, qty, price, status, extra = {}) => ({
    id, product_id: extra.product_id || `prod-${id}`, product_name: name, quantity: qty, unit_price: price,
    subtotal: qty * price, status, notes: null, ...extra,
});

const order = (id, number, status, items, extra = {}) => ({
    id, order_number: number, table_id: 'table-1', status, order_type: 'mesa',
    total: items.reduce((s, i) => s + i.subtotal, 0), amount_paid: 0, source: 'staff',
    created_at: new Date().toISOString(), attention_id: 'att-1', attention_state: 'open',
    items, ...extra,
});

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(el) {
    await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function type(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** Abre la mesa 1 con las cuentas indicadas ya cargadas en la API. */
async function openTableWith(accounts, tableExtra = {}) {
    mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: accounts[0].id, status: accounts[0].status }, ...tableExtra }));
    mockOrders.splice(0, mockOrders.length, ...accounts);
    api.get.mockImplementation((url) => {
        if (url === '/branches') return Promise.resolve({ data: [] });
        const match = accounts.find((o) => url === `/orders/${o.id}`);
        if (match) return Promise.resolve({ data: match });
        return Promise.resolve({ data: accounts });
    });
    const rendered = await renderPage();
    await click(rendered.container.querySelector('[data-testid="mesa-card-1"]'));
    const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
    return { ...rendered, sheet };
}

describe('hoja de mesa · paridad del prototipo (Slice 2)', () => {
    let container;
    let root;
    let sheet;

    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
        mockNavigate.mockReset();
        mockProducts.splice(0, mockProducts.length);
        mockOrders.splice(0, mockOrders.length);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        container = null;
        sheet = null;
        document.body.innerHTML = '';
    });

    it('S2-1 resume Consumido, Pagado y Pendiente de todas las cuentas', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 2, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'María', amount_paid: 12 });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        const consumido = sheet.querySelector('[data-testid="mesa-sheet-consumido"]');
        const pagado = sheet.querySelector('[data-testid="mesa-sheet-pagado"]');
        const pendiente = sheet.querySelector('[data-testid="mesa-sheet-pendiente"]');
        expect(consumido).not.toBeNull();
        expect(consumido.textContent).toContain('Consumido');
        expect(consumido.textContent).toContain('36.00');
        expect(pagado.textContent).toContain('Pagado');
        expect(pagado.textContent).toContain('12.00');
        expect(pendiente.textContent).toContain('Pendiente');
        // Juan debe 24 y María ya pagó: el pendiente de la mesa es 24.
        expect(pendiente.textContent).toContain('24.00');
    });

    it('S2-1 muestra el desglose también con una sola cuenta', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 2, 12, 'pendiente')], { customer_name: 'Juan', amount_paid: 12 });
        ({ container, root, sheet } = await openTableWith([juan]));

        // El bloque plegable de resumen sigue siendo cosa de mesas con varias
        // cuentas; el desglose de plata se ve siempre que la mesa tenga cuenta.
        expect(sheet.querySelector('[data-testid="mesa-sheet-resumen"]')).toBeNull();
        const consumido = sheet.querySelector('[data-testid="mesa-sheet-consumido"]');
        const pagado = sheet.querySelector('[data-testid="mesa-sheet-pagado"]');
        const pendiente = sheet.querySelector('[data-testid="mesa-sheet-pendiente"]');
        expect(consumido).not.toBeNull();
        expect(consumido.textContent).toContain('24.00');
        expect(pagado).not.toBeNull();
        expect(pagado.textContent).toContain('12.00');
        expect(pendiente).not.toBeNull();
        expect(pendiente.textContent).toContain('12.00');
        // Va arriba del cuerpo, antes de la franja de personas.
        const chips = sheet.querySelector('[data-testid="mesa-sheet-cuentas"]');
        expect(chips).not.toBeNull();
        expect(consumido.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('S2-2 ofrece Cobrar con el pendiente de la cuenta activa y navega al pedido', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 2, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'María', amount_paid: 12 });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        const cobrar = sheet.querySelector('[data-testid="mesa-sheet-cobrar"]');
        expect(cobrar).not.toBeNull();
        expect(cobrar.textContent).toContain('Cobrar');
        // La cuenta activa es la de Juan: S/ 24.00.
        expect(cobrar.textContent).toContain('24.00');
        await click(cobrar);
        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/order-1');
    });

    it('S2-2 no ofrece Cobrar cuando no queda saldo pendiente', async () => {
        const pagada = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 2, 12, 'pendiente')], { customer_name: 'Juan', amount_paid: 24 });
        ({ container, root, sheet } = await openTableWith([pagada]));

        expect(sheet.querySelector('[data-testid="mesa-sheet-cobrar"]')).toBeNull();
    });

    it('S2-3 renombra el alias de una persona desde la franja', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente')], { customer_name: null });
        api.patch.mockResolvedValue({ data: { ...maria, customer_name: 'Pedro' } });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        const pencil = sheet.querySelector('[data-testid="mesa-sheet-renombrar-12"]');
        expect(pencil).not.toBeNull();
        await click(pencil);
        const input = sheet.querySelector('[data-testid="mesa-sheet-renombrar-input-12"]');
        expect(input).not.toBeNull();
        await type(input, 'Pedro');
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        // Mismo camino que el input de "Organizar pedido": PATCH del alias.
        expect(api.patch).toHaveBeenCalledWith('/orders/order-2/alias', { alias: 'Pedro', shared: false });
        // La franja refleja el nombre nuevo sin esperar a reabrir la hoja.
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-12"]').textContent).toContain('Pedro');
    });

    it('S2-3 mantiene el input de Organizar pedido junto al ✎', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente')], { customer_name: null });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        expect(sheet.querySelector('[data-testid="mesa-sheet-alias"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-renombrar-11"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-renombrar-12"]')).not.toBeNull();
    });
});
