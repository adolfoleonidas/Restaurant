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

    it('marks every member of a group and keeps the floor in table order', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
            freeTable('table-3', 3),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        ({ container, root } = await renderPage());

        expect(container.querySelector('[data-testid="mesa-card-grupo-1"]').textContent).toContain('Mesas 1 + 2');
        expect(container.querySelector('[data-testid="mesa-card-grupo-2"]').textContent).toContain('Mesas 1 + 2');
        expect(container.querySelector('[data-testid="mesa-card-3"]').getAttribute('data-grouped')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-1"]').getAttribute('data-grouped')).toBe('true');
    });

    it('reads the group account from a joined table without its own order', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesa-card-2"]'));

        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-grupo"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-grupo"]').textContent).toContain('Cuenta de Mesa 1');
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
            freeTable('table-3', 3, { status: 'ocupada', active_attention_id: 'visit-table-3', active_order: { id: 'order-3', status: 'en_preparacion', items: [] } }),
            freeTable('table-4', 4, { status: 'ocupada', active_attention_id: 'visit-table-4', active_order: { id: 'order-4', status: 'en_preparacion', items: [] } }),
        ];
        mockRows.orders = [order('table-3', 'order-3'), order('table-4', 'order-4')];
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="salon-unir-mesas"]'));
        await click(container.querySelector('[data-testid="mesa-card-3"]'));
        await click(container.querySelector('[data-testid="mesa-card-4"]'));

        expect(container.querySelector('[data-testid="salon-seleccion-aviso"]').textContent).toMatch(/pedidos activos/);
        expect(container.querySelector('[data-testid="salon-unir-confirmar"]').disabled).toBe(true);

        await click(container.querySelector('[data-testid="salon-seleccion-cancelar"]'));
        expect(container.querySelector('[data-testid="salon-seleccion"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('dissolves the whole group or a single member from the sheet', async () => {
        mockRows.tables = [
            freeTable('table-1', 1, { status: 'ocupada', active_attention_id: 'visit-table-1', group: joinedGroup, group_id: 'group-1', active_order: { id: 'order-1', status: 'en_preparacion', items: [] } }),
            freeTable('table-2', 2, { status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
        ];
        mockRows.orders = [order('table-1', 'order-1')];
        mockOrderDetails['order-1'] = order('table-1', 'order-1');
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-separar-grupo"]'));
        expect(api.delete).toHaveBeenCalledWith('/table-groups/group-1');

        await click(container.querySelector('[data-testid="mesa-card-1"]'));
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
        await click(document.body.querySelector('[data-testid="mesa-sheet-mover-pedido"]'));

        expect(document.body.querySelector('[data-testid="mover-pedido-sin-mesas"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });
});
