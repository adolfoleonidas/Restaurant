/**
 * CP-02: the kitchen list is only polled for the roles that use kitchen alerts
 * (admin, cocina and mozo, who hear the chime when a pass reaches the kitchen).
 * Cashiers, other roles and signed-out users never reach /orders/kitchen.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KitchenAlerts } from '@/components/KitchenAlerts';
import { getKitchenOrders } from '@/lib/api/orders';
import { forgetOwnKitchenSends, rememberOwnKitchenSend } from '@/lib/ownKitchenSends';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockUser = null;
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
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
    forgetOwnKitchenSends();
    toast.mockClear();
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

describe('el aviso de cocina no te avisa de tu propio envío', () => {
    const ORDER = (id, number) => ({
        id, order_number: number, status: 'enviado_cocina', items: [{ quantity: 1, product_name: 'Caldo' }],
    });

    it('un pase de otro mozo sí avisa', async () => {
        getKitchenOrders.mockResolvedValue({ data: [ORDER('o-otro', 21)] });
        sessionStorage.setItem('kitchen-seen-ids:u1', JSON.stringify(['o-viejo']));

        await mount({ id: 'u1', role: 'mozo' });

        expect(toast).toHaveBeenCalledWith('Pedido #21 en cocina', expect.anything());
    });

    it('el pase que mandaste tú NO te tapa la pantalla', async () => {
        // El mozo manda el pedido y su propio teléfono le avisaba de eso mismo,
        // tapándole la pantalla justo cuando iba a otra mesa.
        rememberOwnKitchenSend('o-mio');
        getKitchenOrders.mockResolvedValue({ data: [ORDER('o-mio', 22)] });
        sessionStorage.setItem('kitchen-seen-ids:u1', JSON.stringify(['o-viejo']));

        await mount({ id: 'u1', role: 'mozo' });

        expect(toast).not.toHaveBeenCalled();
    });
});
