import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

const joinedGroup = { id: 'group-1', name: 'Mesas 1 + 2', anchor_table_id: 'table-1', table_ids: ['table-1', 'table-2'] };

const freeTable = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4, status: 'disponible',
    branch_id: 'branch-1', active_order: null, group: null, group_id: null, ...extra,
});

const order = (tableId, id, extra = {}) => ({
    id, order_number: Number(id.replace(/\D/g, '')) || 1, table_id: tableId,
    attention_id: `visit-${tableId}`, attention_state: 'open', status: 'en_preparacion',
    total: 30, amount_paid: 0, created_at: new Date().toISOString(),
    items: [{ id: `${id}-item`, product_name: 'Ceviche', quantity: 1, subtotal: 30, status: 'pendiente' }],
    ...extra,
});

const mockRows = { tables: [], orders: [] };
const mockOrderDetails = {};
const mockRefreshTables = jest.fn();
const mockRefreshOrders = jest.fn();

jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (fetcher.toString().includes("api.get('/tables')")
        ? { data: mockRows.tables, refetch: mockRefreshTables }
        : { data: mockRows.orders, refetch: mockRefreshOrders }),
}));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('salón table groups', () => {
    let container;
    let root;

    beforeEach(() => {
        mockRows.tables = [];
        mockRows.orders = [];
        for (const key of Object.keys(mockOrderDetails)) delete mockOrderDetails[key];
        mockRefreshTables.mockClear();
        mockRefreshOrders.mockClear();
        api.get.mockReset().mockImplementation((url) => {
            if (url === '/orders') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) return Promise.resolve({ data: mockOrderDetails[url.split('/')[2]] || null });
            return Promise.resolve({ data: [] });
        });
        api.post.mockReset().mockResolvedValue({ data: { ok: true, to_number: 3 } });
        api.delete.mockReset().mockResolvedValue({ data: { ok: true } });
        toast.success.mockClear();
        toast.error.mockClear();
        toast.info.mockClear();
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('collapses a joined group into one big card and keeps the floor in table order', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
            freeTable('table-3', 3),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        ({ container, root } = await renderPage());

        // Tables 1 and 2 collapse into ONE group card (anchor = 1); 3 stays alone.
        expect(container.querySelector('[data-testid="mesa-grupo-1"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="mesa-grupo-1"]').getAttribute('data-grouped')).toBe('true');
        expect(container.querySelector('[data-testid="mesa-grupo-miembro-2"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-1"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-2"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-3"]').getAttribute('data-grouped')).toBeNull();

        // Fixed order by anchor number: group (1) first, then table 3.
        const cards = Array.from(container.querySelectorAll('[data-floor-state]'));
        expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['mesa-grupo-1', 'mesa-card-3']);
    });

    it('reads the group account from a member without its own order', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        // The mini-badge of member 2 opens its sheet, which follows the group's account.
        await click(container.querySelector('[data-testid="mesa-grupo-miembro-2"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-grupo"]').textContent).toContain('Cuenta de Mesa 1');
        // Ver el pedido de la otra mesa es ocasional: vive en ⋯ Más.
        await click(sheet.querySelector('[data-testid="mesa-sheet-mas-grupo"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ver-pedido-grupo"]').textContent).toContain('Mesa 1');
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo-miembro-1"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo-miembro-2"]')).not.toBeNull();
    });

    it('joins the selected tables through the API', async () => {
        mockRows.tables = [freeTable('table-1', 1), freeTable('table-2', 2), freeTable('table-3', 3)];
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="salon-unir-mesas"]'));
        expect(container.querySelector('[data-testid="salon-seleccion"]')).not.toBeNull();
        const confirm = container.querySelector('[data-testid="salon-unir-confirmar"]');
        expect(confirm.disabled).toBe(true);

        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(container.querySelector('[data-testid="mesa-card-2"]'));
        expect(container.querySelector('[data-testid="mesa-card-1"]').getAttribute('data-selected')).toBe('true');
        expect(container.querySelector('[data-testid="salon-seleccion-resumen"]').textContent).toContain('1 + 2');
        expect(confirm.disabled).toBe(false);

        await click(confirm);
        expect(api.post).toHaveBeenCalledWith('/table-groups', { table_ids: ['table-1', 'table-2'] });
        expect(mockRefreshTables).toHaveBeenCalled();
        expect(container.querySelector('[data-testid="salon-seleccion"]')).toBeNull();
    });

    it('explains why a selection cannot be joined and blocks the confirm', async () => {
        mockRows.tables = [
            freeTable('table-1', 1),
            // A visit that never produced an order: there is nothing to group yet.
            freeTable('table-3', 3, { status: 'ocupada', active_attention_id: 'visit-table-3' }),
        ];
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="salon-unir-mesas"]'));
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(container.querySelector('[data-testid="mesa-card-3"]'));

        expect(container.querySelector('[data-testid="salon-seleccion-aviso"]').textContent).toMatch(/visita en curso/);
        expect(container.querySelector('[data-testid="salon-unir-confirmar"]').disabled).toBe(true);

        await click(container.querySelector('[data-testid="salon-seleccion-cancelar"]'));
        expect(container.querySelector('[data-testid="salon-seleccion"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('lets a joined table without its own order start one, on its own account', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
            freeTable('table-3', 3),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesa-grupo-miembro-2"]'));
        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        await click(sheet.querySelector('[data-testid="mesa-sheet-mas-grupo"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ver-pedido-grupo"]')).not.toBeNull();

        await click(sheet.querySelector('[data-testid="mesa-sheet-pedir-grupo"]'));
        // El pedido se compone inline: aparece la carta dentro del sheet, sin
        // navegar a la página de pedidos.
        expect(document.body.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows a joined group as one big card with both separate bills summed', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', active_attention_id: 'visit-table-2', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-2', status: 'en_preparacion', items: [] } }),
        ];
        mockRows.orders = [order('table-1', 'order-1'), order('table-2', 'order-2', { order_number: 12, total: 18 })];
        ({ container, root } = await renderPage());

        // One card, summed balance (30 + 18) and a "2 cuentas" badge: it never
        // pretends there is a single bill.
        expect(container.querySelector('[data-testid="mesa-grupo-1"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="mesa-grupo-cuentas"]').textContent).toContain('2 cuentas');
        expect(container.querySelector('[data-testid="mesa-grupo-total"]').textContent).toContain('Debe S/ 48.00');

        await click(container.querySelector('[data-testid="mesa-grupo-1"]'));
        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo-resumen"]').textContent).toContain('2 cuentas separadas');
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo-cuenta-1"]').textContent).toContain('Mesa 1');
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo-cuenta-2"]').textContent).toContain('Mesa 2');
        // The sheet of a table with its own bill never follows another one.
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-grupo"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('joins tables that each have a running order through the API', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', active_attention_id: 'visit-table-2', active_order: { id: 'order-2', status: 'en_preparacion', items: [] } }),
        ];
        mockRows.orders = [order('table-1', 'order-1'), order('table-2', 'order-2')];
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="salon-unir-mesas"]'));
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(container.querySelector('[data-testid="mesa-card-2"]'));
        const confirm = container.querySelector('[data-testid="salon-unir-confirmar"]');

        expect(container.querySelector('[data-testid="salon-seleccion-aviso"]')).toBeNull();
        expect(confirm.disabled).toBe(false);
        await click(confirm);
        expect(api.post).toHaveBeenCalledWith('/table-groups', { table_ids: ['table-1', 'table-2'] });
    });

    it('dissolves the whole group or a single member from the sheet', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesa-grupo-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-separar-grupo"]'));
        expect(api.delete).toHaveBeenCalledWith('/table-groups/group-1');

        await click(container.querySelector('[data-testid="mesa-grupo-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-quitar-grupo-2"]'));
        expect(api.delete).toHaveBeenCalledWith('/table-groups/group-1/tables/table-2');
    });

    it('moves the open visit to the table picked in the dialog', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-3', 3),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-mas"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-mover-pedido"]'));

        expect(document.body.querySelector('[data-testid="mover-pedido"]')).not.toBeNull();
        await click(document.body.querySelector('[data-testid="mover-pedido-mesa-3"]'));

        expect(api.post).toHaveBeenCalledWith('/tables/table-1/transfer', { target_table_id: 'table-3' });
        expect(mockRefreshTables).toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalled();
    });

    it('keeps the transfer dialog honest when there is nowhere to move the visit', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-mas"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-mover-pedido"]'));

        expect(document.body.querySelector('[data-testid="mover-pedido-sin-mesas"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });
});
