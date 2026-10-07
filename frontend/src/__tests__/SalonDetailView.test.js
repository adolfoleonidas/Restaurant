/**
 * Detalle de mesa como VISTA completa (S7, presentación del prototipo).
 *
 * Reemplaza el Sheet lateral: cabecera con volver, layout de dos columnas
 * ≥820px (pedidos | resumen sticky), tarjetas por cuenta y barra de acciones
 * fija en móvil. Los comportamientos y testids existentes se mantienen.
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

describe('detalle de mesa · vista completa (S7)', () => {
    let container;
    let root;
    let sheet;

    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
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

    it('abre la vista completa con layout de dos columnas, resumen sticky y barra de acciones', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([juan]));

        expect(sheet).not.toBeNull();
        // Ya no es un diálogo lateral de Radix.
        expect(sheet.getAttribute('role')).not.toBe('dialog');
        expect(sheet.querySelector('[data-testid="mesa-sheet-volver"]')).not.toBeNull();

        const layout = sheet.querySelector('[data-testid="mesa-sheet-layout"]');
        expect(layout.className).toContain('min-[820px]:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.65fr)]');
        const aside = sheet.querySelector('[data-testid="mesa-sheet-resumen-panel"]');
        expect(aside.className).toContain('min-[820px]:sticky');
        const bar = sheet.querySelector('[data-testid="mesa-sheet-acciones"]');
        expect(bar.className).toContain('fixed');
        expect(bar.className).toContain('bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))]');
        expect(aside.contains(bar)).toBe(true);

        // La grilla del salón queda oculta detrás de la vista.
        expect(container.querySelector('[data-testid="mesa-card-1"]').closest('[hidden]')).not.toBeNull();
    });

    it('el botón volver regresa a la grilla del salón', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([juan]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-1"]').closest('[hidden]')).toBeNull();
    });

    it('Escape también vuelve a la grilla (contrato del e2e)', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([juan]));

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.body.querySelector('[data-testid="mesa-sheet"]')).toBeNull();
    });

    it('arma una tarjeta por cuenta y el resumen con Pedidos, Pendiente y Cobrar', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Chicha', 1, 10, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        const cardJuan = sheet.querySelector('[data-testid="mesa-sheet-pedido-11"]');
        const cardMaria = sheet.querySelector('[data-testid="mesa-sheet-pedido-12"]');
        expect(cardJuan).not.toBeNull();
        expect(cardMaria).not.toBeNull();

        // La cuenta activa trae la lista editable; la otra, sus platos en lectura.
        expect(cardJuan.querySelector('[data-testid="mesa-sheet-items"]')).not.toBeNull();
        expect(cardMaria.textContent).toContain('Chicha');

        const aside = sheet.querySelector('[data-testid="mesa-sheet-resumen-panel"]');
        expect(aside.querySelector('[data-testid="mesa-sheet-pedidos-count"]').textContent).toBe('2');
        expect(aside.querySelector('[data-testid="mesa-sheet-pendiente"]').textContent).toContain('22.00');
        expect(aside.querySelector('[data-testid="mesa-sheet-cobrar"]')).not.toBeNull();
    });

    it('tocar la tarjeta de otra cuenta la vuelve la activa', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Lomo', 1, 20, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-pedido-12"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-items"]').textContent).toContain('Lomo');
        expect(sheet.querySelector('[data-testid="mesa-sheet-items"]').textContent).not.toContain('Sopa');
    });

    it('muestra el estado vacío del prototipo en una mesa libre', async () => {
        mockTables.splice(0, mockTables.length, baseTable(1, { status: 'disponible', active_attention_id: null, active_order: null }));
        mockOrders.splice(0, mockOrders.length);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });
        const rendered = await renderPage();
        container = rendered.container;
        root = rendered.root;
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        sheet = document.body.querySelector('[data-testid="mesa-sheet"]');

        const vacio = sheet.querySelector('[data-testid="mesa-sheet-vacio"]');
        expect(vacio).not.toBeNull();
        expect(vacio.textContent).toContain('Mesa libre');
        expect(vacio.textContent).toContain('Toca «Nuevo pedido» para empezar.');
        expect(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).not.toBeNull();
    });

    it('"+ Nuevo pedido" abre la carta dentro de la vista', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([juan]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        // S9: el compositor es la pantalla del tomador (posView): la cabecera
        // pasa a "Pedido · Mesa N" y las tarjetas del detalle se reemplazan por
        // la carta + el ticket del borrador. El botón de la barra se desmonta
        // porque la barra pertenece al detalle.
        expect(sheet.querySelector('[data-testid="mesa-sheet-producto-prod-n1"]')).not.toBeNull();
        expect(sheet.textContent).toContain('Pedido · Mesa 1');
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido-11"]')).toBeNull();
    });
});
