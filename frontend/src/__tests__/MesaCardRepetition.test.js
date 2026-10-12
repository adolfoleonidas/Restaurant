import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

const mockUser = { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' };
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

let mockTables = [];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(fetcher.toString())
        ? { data: mockTables, refetch: jest.fn() }
        : { data: null, refetch: jest.fn() }),
}));

const baseTable = (overrides) => ({
    capacity: 4, area: 'Salón', active_attention_id: null, active_order: null, qr_status: 'active', ...overrides,
});
const order = (overrides) => ({
    id: 'order-x', order_number: 1, status: 'aceptado', source: 'staff', items: [],
    created_at: new Date().toISOString(), ...overrides,
});

describe('Salón table cards do not repeat themselves', () => {
    let host;
    let root;

    beforeEach(() => {
        mockUser.role = 'admin';
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/branches' ? [] : null }));
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    const render = async () => { root = createRoot(host); await act(async () => root.render(<Salon />)); };
    const cardOf = (number) => host.querySelector(`[data-testid="mesa-card-${number}"]`);
    const pricedOnce = (card) => (card.textContent.match(/42\.00/g) || []).length;

    it('prints the amount once when the whole ticket is still owed', async () => {
        mockTables = [baseTable({
            id: 't3', number: 3, status: 'esperando_pago',
            active_order: order({ id: 'o3', status: 'pendiente_pago', total: 42, amount_paid: 0 }),
        })];
        await render();

        const card = cardOf(3);
        expect(card.getAttribute('data-floor-state')).toBe('cuenta');
        expect(card.textContent).toContain('Debe S/ 42.00');
        // No second "S/ 42.00" line repeating the same ticket total.
        expect(pricedOnce(card)).toBe(1);
        expect(card.textContent).not.toContain('Cuenta solicitada');
    });

    it('adds the ticket total only when a partial payment makes it differ from the balance', async () => {
        mockTables = [baseTable({
            id: 't4', number: 4, status: 'esperando_pago',
            active_order: order({ id: 'o4', status: 'pendiente_pago', total: 50, amount_paid: 8 }),
        })];
        await render();

        const card = cardOf(4);
        expect(card.textContent).toContain('Debe S/ 42.00');
        expect(card.textContent).toContain('Total S/ 50.00');
    });

    it('renders one "Tomar pedido" action per takeable table, with the plus only on free tables', async () => {
        mockTables = [
            baseTable({ id: 't1', number: 1, status: 'disponible' }),
            baseTable({ id: 't2', number: 2, status: 'ocupada', active_order: order({ id: 'o2', total: 20 }) }),
        ];
        await render();

        for (const number of [1, 2]) {
            const buttons = cardOf(number).querySelectorAll(`[data-testid="mesa-card-pedir-${number}"]`);
            expect(buttons).toHaveLength(1);
            expect(buttons[0].textContent).toBe('Tomar pedido');
        }
        expect(cardOf(1).querySelector('[data-testid="mesa-card-pedir-1"] svg')).not.toBeNull();
        expect(cardOf(2).querySelector('[data-testid="mesa-card-pedir-2"] svg')).toBeNull();
    });

    it('renders no action footer at all when the role has no action on a free table', async () => {
        mockUser.role = 'cocina';
        mockTables = [baseTable({ id: 't1', number: 1, status: 'disponible' })];
        await render();

        expect(cardOf(1).querySelectorAll('button')).toHaveLength(0);
    });
});
