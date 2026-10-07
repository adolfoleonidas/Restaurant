/**
 * Compositor como el prototipo (S8, posView).
 *
 * - Franja "Para {persona} · ✎ Nombre" arriba de la carta.
 * - Móvil: FAB "Ver pedido · …" + hoja inferior del borrador (scrim, líneas
 *   con stepper y nota, nota general y envío).
 * - El contenido inline sigue montado: el e2e móvil verifica
 *   `mesa-sheet-items` visible sin abrir ninguna hoja.
 */
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

/** Abre la mesa 1. Un borrador ('nuevo' con ítems en borrador) abre la carta sola. */
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

describe('compositor · paridad posView (S8)', () => {
    let container;
    let root;
    let sheet;

    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
        api.patch.mockResolvedValue({ data: {} });
        api.post.mockResolvedValue({ data: {} });
        mockProducts.splice(0, mockProducts.length,
            { id: 'prod-n1', name: 'Ceviche', price: 38, is_available: true, category_id: 'c1' });
        mockOrders.splice(0, mockOrders.length);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        container = null;
        sheet = null;
        document.body.innerHTML = '';
    });

    it('muestra la franja "Para {persona}" con renombre reusando el alias existente', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([draft]));

        const bar = sheet.querySelector('[data-testid="mesa-sheet-persona"]');
        expect(bar).not.toBeNull();
        expect(bar.textContent).toContain('Para');
        expect(bar.textContent).toContain('Juan');

        await click(sheet.querySelector('[data-testid="mesa-sheet-persona-renombrar"]'));
        const input = sheet.querySelector('[data-testid="mesa-sheet-persona-nombre"]');
        expect(input).not.toBeNull();
        await type(input, 'Pedro');
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/alias', { alias: 'Pedro', shared: false });
    });

    it('móvil: FAB con los nuevos y monto, y hoja del borrador con scrim', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 2, 12, 'borrador')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([draft]));

        const fab = sheet.querySelector('[data-testid="mesa-sheet-fab"]');
        expect(fab).not.toBeNull();
        expect(fab.textContent).toContain('Ver pedido');
        expect(fab.textContent).toContain('2 nuevos');
        expect(fab.textContent).toContain('S/ 24.00');
        expect(fab.className).toContain('min-[820px]:hidden');

        // El contrato del e2e móvil sigue a la vista sin abrir la hoja.
        expect(sheet.querySelector('[data-testid="mesa-sheet-items"]')).not.toBeNull();

        await click(fab);
        const ticket = sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]');
        expect(ticket).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-ticket-items"]')).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-ticket-nota-general"]')).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-ticket-enviar"]').textContent).toContain('S/ 24.00');

        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-scrim"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
    });

    it('envía a cocina desde la hoja del borrador y la cierra', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: { ...draft, status: 'enviado_cocina' } });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-fab"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-enviar"]'));

        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
    });

    it('sin borrador no hay FAB ni hoja', async () => {
        const sent = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([sent]));

        // La carta se abre a mano cuando la cuenta ya salió a cocina.
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-fab"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
    });
});
