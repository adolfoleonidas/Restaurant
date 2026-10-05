import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Pedidos from '@/pages/Pedidos';
import { api } from '@/lib/api';
import { ORDER_AREAS } from '@/lib/format';

const mockNavigate = jest.fn();
const mockTables = [
    { id: 'table-2', number: 9, name: 'Mesa 9', area: 'Salón', capacity: 4, status: 'ocupada', active_order: { id: 'o9', status: 'en_preparacion', items: [] } },
    { id: 'table-1', number: 7, name: 'Mesa 7', area: 'Salón', capacity: 4, status: 'disponible', active_order: null },
];

// The page polls the order list and, for the sales-area dialog, the floor.
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (fetcher.toString().includes("api.get('/tables')")
        ? { data: mockTables }
        : { data: [] }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('orders page entry point', () => {
    let host; let root;

    beforeEach(() => {
        mockNavigate.mockClear();
        api.get.mockReset().mockResolvedValue({ data: [] });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    const openAreas = async () => {
        await act(async () => root.render(<Pedidos />));
        await act(async () => host.querySelector('[data-testid="pedidos-nuevo-button"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };

    it('asks for the sales area before opening the composer', async () => {
        await openAreas();

        expect(mockNavigate).not.toHaveBeenCalled();
        for (const area of ORDER_AREAS) {
            expect(document.body.querySelector(`[data-testid="area-${area.key}"]`)).not.toBeNull();
        }

        await act(async () => document.body.querySelector('[data-testid="area-recojo"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/nuevo?tipo=recojo');
    });

    it('offers the free tables when the area is dine-in', async () => {
        await openAreas();
        await act(async () => document.body.querySelector('[data-testid="area-mesa"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        // Only truly free tables are offered, and picking one targets its own order.
        expect(document.body.querySelector('[data-testid="mesa-disponible-9"]')).toBeNull();
        await act(async () => document.body.querySelector('[data-testid="mesa-disponible-7"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(mockNavigate).toHaveBeenCalledWith('/pedidos/nuevo?mesa=table-1');
    });
});
