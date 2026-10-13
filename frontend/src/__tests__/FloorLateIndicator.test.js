/**
 * NA-01: a late table is a static indicator, not a pulse.
 *
 * `.floor-late` used to pulse a box-shadow forever and kept a low-end phone's
 * main thread 98-99 % busy with five late tables. A late card now carries a
 * destructive border and ring that never move, plus an "Atrasada" label so the
 * signal is not colour only. What counts as late is unchanged: the bill is
 * pending and the table has been waiting 45 minutes or more.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'fs';
import path from 'path';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

const mockUser = { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' };
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const mockRows = { tables: [], orders: [] };
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(fetcher.toString())
        ? { data: mockRows.tables, refetch: jest.fn() }
        : { data: mockRows.orders, refetch: jest.fn() }),
}));

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const billOrder = (id, minutes, extra = {}) => ({
    id, order_number: 1, status: 'pendiente_pago', source: 'staff', total: 40, amount_paid: 0, items: [],
    created_at: minutesAgo(minutes), ...extra,
});
const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, capacity: 4, area: 'Salón', status: 'disponible',
    active_attention_id: null, active_order: null, qr_status: 'active', group: null, group_id: null, ...extra,
});
const waitingBill = (id, number, minutes) => table(id, number, {
    status: 'esperando_pago', active_order: billOrder(`order-${number}`, minutes),
});
const joined = { id: 'group-1', name: 'Mesas 1 + 2', anchor_table_id: 'table-1', table_ids: ['table-1', 'table-2'] };

describe('late tables on the Salón floor (NA-01)', () => {
    let host;
    let root;

    beforeEach(() => {
        mockUser.role = 'admin';
        mockRows.tables = [];
        mockRows.orders = [];
        api.get.mockReset().mockImplementation((url) => Promise.resolve({ data: url === '/branches' ? [] : null }));
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
    const groupOf = (number) => host.querySelector(`[data-testid="mesa-grupo-${number}"]`);
    const labelsIn = (card) => (card.textContent.match(/Atrasada/g) || []).length;

    it('marks a table with a pending bill for 45 minutes or more with a border class and an "Atrasada" label', async () => {
        mockRows.tables = [waitingBill('table-5', 5, 50)];
        await render();

        const card = cardOf(5);
        expect(card.getAttribute('data-floor-state')).toBe('cuenta');
        expect(card.className).toContain('floor-late');
        const label = card.querySelector('[data-testid="mesa-card-atrasada-5"]');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('Atrasada');
        // The label is text, not colour: it is printed exactly once.
        expect(labelsIn(card)).toBe(1);
        // The state label and the waiting time are still printed.
        expect(card.textContent).toContain('Cuenta');
        expect(card.textContent).toContain('Hace 50 min');
    });

    it('does not mark a table that is still within the 45 minutes', async () => {
        mockRows.tables = [waitingBill('table-6', 6, 35)];
        await render();

        const card = cardOf(6);
        expect(card.className).not.toContain('floor-late');
        expect(card.querySelector('[data-testid="mesa-card-atrasada-6"]')).toBeNull();
        expect(labelsIn(card)).toBe(0);
    });

    it('does not mark a long wait that is not a pending bill', async () => {
        mockRows.tables = [table('table-7', 7, {
            status: 'ocupada',
            active_order: billOrder('order-7', 90, { status: 'en_preparacion' }),
        })];
        await render();

        const card = cardOf(7);
        expect(card.getAttribute('data-floor-state')).toBe('preparando');
        expect(card.className).not.toContain('floor-late');
        expect(labelsIn(card)).toBe(0);
    });

    it('marks a joined group card the same way when its bill has waited too long', async () => {
        mockRows.tables = [
            table('table-1', 1, { status: 'esperando_pago', group: joined, group_id: 'group-1', active_order: billOrder('order-1', 50) }),
            table('table-2', 2, { status: 'ocupada', group: joined, group_id: 'group-1' }),
        ];
        await render();

        const card = groupOf(1);
        expect(card).not.toBeNull();
        expect(card.getAttribute('data-floor-state')).toBe('cuenta');
        expect(card.className).toContain('floor-late');
        const label = card.querySelector('[data-testid="mesa-grupo-atrasada"]');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('Atrasada');
        expect(labelsIn(card)).toBe(1);
    });

    it('leaves a joined group card alone while its bill is recent', async () => {
        mockRows.tables = [
            table('table-1', 1, { status: 'esperando_pago', group: joined, group_id: 'group-1', active_order: billOrder('order-1', 10) }),
            table('table-2', 2, { status: 'ocupada', group: joined, group_id: 'group-1' }),
        ];
        await render();

        const card = groupOf(1);
        expect(card.className).not.toContain('floor-late');
        expect(labelsIn(card)).toBe(0);
    });
});

describe('static indicators in index.css (NA-01)', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'index.css'), 'utf8');
    const ruleOf = (selector) => css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*\\}`))[0];

    it('draws .floor-late as a destructive border and ring that never move', () => {
        const rule = ruleOf('.floor-late');
        expect(rule).toMatch(/border-color:\s*hsl\(var\(--destructive\)\)/);
        expect(rule).toMatch(/box-shadow:\s*0 0 0 \d+px hsl\(var\(--destructive\)/);
        expect(rule).not.toMatch(/animation|transition/);
        expect(css).not.toContain('floor-late-pulse');
    });

    it('keeps .pulse-dot as a plain dot', () => {
        const rule = ruleOf('.pulse-dot');
        expect(rule).toMatch(/border-radius:\s*50%/);
        expect(rule).not.toMatch(/animation|transition|transform/);
        expect(css).not.toContain('pulse-soft');
    });
});
