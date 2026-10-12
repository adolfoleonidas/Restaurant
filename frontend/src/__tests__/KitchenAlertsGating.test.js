/**
 * CP-02: the kitchen list is only polled for the roles that use kitchen alerts
 * (admin, cocina and mozo, who hear the chime when a pass reaches the kitchen).
 * Cashiers, other roles and signed-out users never reach /orders/kitchen.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KitchenAlerts } from '@/components/KitchenAlerts';
import { getKitchenOrders } from '@/lib/api/orders';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockUser = null;
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock('@/lib/api/orders', () => ({ getKitchenOrders: jest.fn() }));

let host;
let root;

const mount = async (user) => {
    mockUser = user;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<KitchenAlerts />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
    getKitchenOrders.mockReset().mockResolvedValue({ data: [] });
    sessionStorage.clear();
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

describe('KitchenAlerts role gating', () => {
    test.each(['cajero', 'repartidor', undefined])('role %s never requests the kitchen list', async (role) => {
        await mount({ id: 'u1', role });
        expect(getKitchenOrders).not.toHaveBeenCalled();
        expect(host.textContent).toBe('');
    });

    it('a signed-out visitor never requests the kitchen list', async () => {
        await mount(null);
        expect(getKitchenOrders).not.toHaveBeenCalled();
    });

    test.each(['admin', 'cocina', 'mozo'])('role %s polls the kitchen list', async (role) => {
        await mount({ id: 'u1', role });
        expect(getKitchenOrders).toHaveBeenCalledTimes(1);
    });
});
