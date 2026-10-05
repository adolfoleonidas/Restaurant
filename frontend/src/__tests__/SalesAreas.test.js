import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { ORDER_AREAS, ORDER_TYPE_LABELS } from '@/lib/format';

const mockNavigate = jest.fn();
// Deliberately out of order and in different states: the floor must still list
// them by table number (12 pending payment, 7 free, 5 seated with no order yet,
// 3 preparing).
const mockTables = [
    { id: 'table-3', number: 12, name: 'Mesa 12', area: 'Salón', capacity: 4, status: 'ocupada', active_order: { id: 'o12', status: 'pendiente_pago', items: [] } },
    { id: 'table-1', number: 7, name: 'Mesa 7', area: 'Salón', capacity: 4, status: 'disponible', active_order: null },
    { id: 'table-4', number: 5, name: 'Mesa 5', area: 'Salón', capacity: 4, status: 'ocupada', active_order: null },
    { id: 'table-2', number: 3, name: 'Mesa 3', area: 'Salón', capacity: 4, status: 'ocupada', active_order: { id: 'o3', status: 'en_preparacion', items: [] } },
];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (fetcher.toString().includes("api.get('/tables')")
        ? { data: mockTables, refetch: jest.fn() }
        : { data: [] }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('sales areas', () => {
    let host; let root;

    beforeEach(() => {
        mockNavigate.mockClear();
        api.get.mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockReset();
        api.post.mockImplementation(() => Promise.resolve({ data: {} }));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    it('defines an area for every order type the waiter can pick', () => {
        expect(ORDER_AREAS.map((area) => area.key)).toEqual(['mesa', 'llevar', 'recojo', 'delivery']);
        expect(ORDER_TYPE_LABELS.llevar).toBe('Llevar');
        for (const area of ORDER_AREAS) {
            expect(ORDER_TYPE_LABELS[area.key]).toBeTruthy();
            expect(area.hint).toBeTruthy();
        }
    });

    it('keeps the floor in table-number order no matter the state', async () => {
        await act(async () => root.render(<Salon />));
        const numbers = [...host.querySelectorAll('[data-floor-state]')]
            .map((el) => el.getAttribute('data-testid').replace('mesa-card-', ''));
        expect(numbers).toEqual(['3', '5', '7', '12']);
    });

    it('offers the four areas when taking an order', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="salon-nuevo-pedido"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        for (const area of ORDER_AREAS) {
            expect(document.body.querySelector(`[data-testid="area-${area.key}"]`)).not.toBeNull();
        }
    });

    it('routes a counter takeaway order by its type', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="salon-nuevo-pedido"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await act(async () => document.body.querySelector('[data-testid="area-llevar"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/nuevo?tipo=llevar');
    });

    it('asks for the table only when the area is dine-in', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="salon-nuevo-pedido"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        // Picking "Mesa" reveals the table grid instead of navigating straight away.
        await act(async () => document.body.querySelector('[data-testid="area-mesa"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(document.body.querySelector('[data-testid="areas-venta-mesas"]')).not.toBeNull();

        await act(async () => document.body.querySelector('[data-testid="salon-mesa-disponible-7"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/nuevo?mesa=table-1');
    });

    it('routes the free table card shortcut through the areas instead of the composer', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="mesa-card-pedir-7"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        // The shortcut no longer skips the decision nor seats the table by itself.
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(api.post).not.toHaveBeenCalled();
        expect(document.body.querySelector('[data-testid="areas-venta-mesa"]').textContent).toContain('Mesa 7');
        for (const area of ORDER_AREAS) {
            expect(document.body.querySelector(`[data-testid="area-${area.key}"]`)).not.toBeNull();
        }

        // Dine-in is still the only choice that occupies the table.
        await act(async () => document.body.querySelector('[data-testid="area-mesa"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(api.post).toHaveBeenCalledWith('/tables/table-1/seat');
        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/nuevo?mesa=table-1');
    });

    it('offers the same areas from a seated table and leaves it untouched for a takeaway', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="mesa-card-pedir-5"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(mockNavigate).not.toHaveBeenCalled();
        expect(document.body.querySelector('[data-testid="areas-venta-mesa"]').textContent).toContain('Mesa 5');

        await act(async () => document.body.querySelector('[data-testid="area-llevar"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/nuevo?tipo=llevar');
        expect(api.post).not.toHaveBeenCalled();
    });
});
