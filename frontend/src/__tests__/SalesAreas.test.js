import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { ORDER_AREAS, ORDER_TYPE_LABELS } from '@/lib/format';

const mockNavigate = jest.fn();
const mockTables = [{ id: 'table-1', number: 7, name: 'Mesa 7', area: 'Salón', capacity: 4, status: 'disponible', active_order: null }];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
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
});
