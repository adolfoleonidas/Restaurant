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

    it('offers the four sales types as tabs of the same panel', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="salon-nuevo-pedido"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(document.body.querySelector('[data-testid="nuevo-pedido-sheet"]')).not.toBeNull();
        for (const area of ORDER_AREAS) {
            expect(document.body.querySelector(`[data-testid="nuevo-pedido-tipo-${area.key}"]`)).not.toBeNull();
        }
    });

    it('composes a takeaway order inline instead of routing to its page', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="salon-nuevo-pedido"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await act(async () => document.body.querySelector('[data-testid="nuevo-pedido-tipo-llevar"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(mockNavigate).not.toHaveBeenCalled();
        const sheet = document.body.querySelector('[data-testid="nuevo-pedido-sheet"]');
        expect(sheet.querySelector('[data-testid="nuevo-pedido-pedido"]')).not.toBeNull();
        // La orden nace con el primer producto, no al abrir el panel.
        expect(api.post).not.toHaveBeenCalled();
    });

    it('asks for the table on the dine-in tab, then composes inline on it', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="salon-nuevo-pedido"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        // La pestaña Mesa pide la mesa dentro del mismo panel.
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(document.body.querySelector('[data-testid="nuevo-pedido-mesas"]')).not.toBeNull();

        // Elegir la mesa abre el compositor de esa mesa: sin cambiar de página.
        await act(async () => document.body.querySelector('[data-testid="nuevo-pedido-mesa-7"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(mockNavigate).not.toHaveBeenCalled();
        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
    });

    it('opens the inline composer from the table card shortcut without seating or navigating', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="mesa-card-pedir-7"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        // No area dialog and no page change: the sheet composes the order, and the
        // account is created lazily on the first product (nothing is posted yet).
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(api.post).not.toHaveBeenCalled();
        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
    });

    it('offers the inline composer for a seated table too', async () => {
        await act(async () => root.render(<Salon />));
        await act(async () => host.querySelector('[data-testid="mesa-card-pedir-5"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(mockNavigate).not.toHaveBeenCalled();
        expect(api.post).not.toHaveBeenCalled();
        const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
    });
});
