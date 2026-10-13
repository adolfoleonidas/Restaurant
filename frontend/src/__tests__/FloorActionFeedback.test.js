import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import MiniOrderBar from '@/pages/salon/MiniOrderBar';
import { PendingActionsContext } from '@/contexts/PendingActionsContext';
import { buildMoreActions } from '@/pages/salon/sheetActions';
import { api } from '@/lib/api';

// `var` on purpose: jest.mock factories are hoisted above constants.
var mockTables = [{
    id: 't1', number: 1, name: 'Mesa 1', status: 'ocupada', capacity: 4, area: 'Salon',
    active_attention_id: null, qr_status: 'active',
    active_order: { id: 'o1', order_number: 11, status: 'listo', source: 'staff', total: 30, created_at: new Date().toISOString() },
}];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = String(fetcher);
        if (src.includes('listTables')) return { data: mockTables, refetch: jest.fn() };
        if (src.includes('listOrders')) return { data: [], refetch: jest.fn() };
        return { data: null, refetch: jest.fn() };
    },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('floor card actions show they are working', () => {
    let container; let root;
    afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ''; });

    it('Entregar sends one request for repeated taps and shows Entregando… while pending', async () => {
        api.get.mockReset().mockResolvedValue({ data: [] });
        let resolve;
        api.post.mockReset().mockReturnValue(new Promise((r) => { resolve = r; }));
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => { root.render(<Salon />); await Promise.resolve(); await Promise.resolve(); });
        const btn = () => container.querySelector('[data-testid="mesa-card-deliver-1"]');
        await act(async () => { btn().click(); });
        await act(async () => { btn().click(); btn().click(); });
        expect(api.post.mock.calls.filter(([url]) => url === '/orders/o1/serve')).toHaveLength(1);
        expect(btn().textContent).toContain('Entregando…');
        expect(btn().disabled).toBe(true);
        expect(btn().getAttribute('aria-busy')).toBe('true');
        await act(async () => { resolve({ data: {} }); await Promise.resolve(); });
    });
});

describe('pending labels in the occasional menu and the mini bar', () => {
    const ctx = (extra = {}) => ({
        t: { id: 't1', number: 4, status: 'ocupada' },
        order: { id: 'o1', items: [] },
        accountTable: null,
        accounts: [{ id: 'o1' }],
        hasAccount: true,
        floor: { key: 'listo' },
        actionOrder: { id: 'o1', status: 'listo', items: [{ status: 'pendiente' }] },
        actionAccountId: 'o1',
        closeable: false,
        billRequested: false,
        closing: null,
        canTake: true,
        canServe: true,
        pending: new Set(),
        closeSheet: jest.fn(), navigate: jest.fn(), deliver: jest.fn(), requestBill: jest.fn(),
        ...extra,
    });

    it('menu items read the pending set', () => {
        const actions = buildMoreActions(ctx({ pending: new Set(['deliver:o1', 'bill:o1']) }));
        const byKey = Object.fromEntries(actions.map((a) => [a.key, a]));
        expect(byKey.entregar.label).toBe('Entregando…');
        expect(byKey.entregar.disabled).toBe(true);
        expect(byKey['solicitar-cuenta'].label).toBe('Solicitando…');
        expect(byKey['solicitar-cuenta'].disabled).toBe(true);
        const idle = Object.fromEntries(buildMoreActions(ctx()).map((a) => [a.key, a]));
        expect(idle.entregar.label).toBe('Entregar');
        expect(idle.entregar.disabled).toBeFalsy();
    });

    it('releasing a paid table shows Liberando…', () => {
        const actions = buildMoreActions(ctx({ hasAccount: false, t: { id: 't1', number: 4, status: 'pagada' }, pending: new Set(['release:t1']) }));
        expect(actions[0].label).toBe('Liberando…');
        expect(actions[0].disabled).toBe(true);
    });

    it('the mini bar action shows Entregando… from the context', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const r = createRoot(host);
        const order = { id: 'o1', order_number: 3, status: 'listo', total: 10, items: [{ id: 'i1', status: 'listo', quantity: 1, product_name: 'Lomo' }] };
        await act(async () => r.render(
            <PendingActionsContext.Provider value={new Set(['deliver:o1'])}>
                <MiniOrderBar miniOrder={order} lastOpened={{ table: { number: 1 } }} deliver={jest.fn()} requestSend={jest.fn()} openTrackedSheet={jest.fn()} />
            </PendingActionsContext.Provider>
        ));
        const btn = host.querySelector('[data-testid="salon-mini-accion"]');
        expect(btn.textContent).toBe('Entregando…');
        expect(btn.disabled).toBe(true);
        await act(async () => r.unmount());
        host.remove();
    });
});
