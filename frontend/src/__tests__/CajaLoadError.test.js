import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CajaWorkspace from '@/pages/caja/CajaWorkspace';
import { get } from '@/lib/api/request';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/request', () => ({ get: jest.fn() }));
jest.mock('@/lib/api/orders', () => ({ confirmOrderPayment: jest.fn() }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'c1', role: 'cajero', functions: ['cobro'] } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams()] }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/CobrarDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/caja/OpenCajaCard', () => ({ __esModule: true, default: () => <div data-testid="open-caja-card" /> }));
jest.mock('@/pages/caja/CashHistory', () => ({ __esModule: true, default: () => null }));

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('Caja when the register cannot be read', () => {
    let root;
    let host;
    beforeEach(async () => {
        get.mockReset().mockRejectedValue({ response: { status: 500, data: {} } });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<CajaWorkspace runMutation={(fn) => fn()} />));
        await flush();
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    it('says so and offers Reintentar instead of offering to open the register', async () => {
        const alert = host.querySelector('[data-testid="caja-error"]');
        expect(alert).not.toBeNull();
        expect(alert.textContent).toContain('No se pudo leer la caja');
        expect(host.querySelector('[data-testid="open-caja-card"]')).toBeNull();
        const callsBefore = get.mock.calls.length;
        await act(async () => host.querySelector('[data-testid="caja-error-reintentar"]').click());
        await flush();
        expect(get.mock.calls.length).toBeGreaterThan(callsBefore);
    });
});
