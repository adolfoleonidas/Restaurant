import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Servicio from '@/pages/Servicio';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockVisit = {
    id: 'order-1', table_id: 'table-1', attention_id: 'visit-1', attention_state: 'open',
    status: 'pagado', payment_status: 'pagado', amount_paid: 25, total: 25,
    items: [{ id: 'item-1', status: 'entregado', quantity: 1 }],
};
const mockTable = { id: 'table-1', number: 1, status: 'ocupada', active_attention_id: 'visit-1' };
const mockRows = { tables: [mockTable], orders: [mockVisit] };
const mockUser = { role: 'admin' };
const mockRefreshTables = jest.fn();
const mockRefreshOrders = jest.fn();

jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => fetcher.toString().includes("api.get('/tables')")
        ? { data: mockRows.tables, refetch: mockRefreshTables }
        : { data: mockRows.orders, refetch: mockRefreshOrders },
}));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a>, useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Servicio />));
    return { container, root };
}

describe('Servicio attention closure', () => {
    beforeEach(() => {
        mockUser.role = 'admin';
        mockRows.tables = [{ ...mockTable }];
        mockRows.orders = [{ ...mockVisit, items: [...mockVisit.items] }];
        mockRefreshTables.mockClear();
        mockRefreshOrders.mockClear();
        api.post.mockReset().mockResolvedValue({ data: { status: 'closed' } });
        toast.error.mockClear();
        toast.success.mockClear();
    });

    it('closes only the exact active visit without sending a payment and refreshes server state', async () => {
        const { container, root } = await renderPage();
        const button = container.querySelector('[data-testid="servicio-cerrar-1"]');
        expect(button).not.toBeNull();
        await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/attention/close');
        expect(mockRefreshOrders).toHaveBeenCalled();
        expect(mockRefreshTables).toHaveBeenCalled();
        await act(async () => root.unmount());
        container.remove();
    });

    it('keeps a failed close retryable and never reports it as successful', async () => {
        api.post.mockRejectedValueOnce({ response: { data: { detail: 'El cierre quedó pendiente' } } });
        const { container, root } = await renderPage();
        await act(async () => container.querySelector('[data-testid="servicio-cerrar-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(toast.error).toHaveBeenCalledWith('El cierre quedó pendiente');
        expect(toast.success).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="servicio-cerrar-1"]')).not.toBeNull();
        await act(async () => root.unmount());
        container.remove();
    });

    it('shows a bill request from the explicit flag without replacing food status', async () => {
        mockRows.orders = [{ ...mockVisit, status: 'listo', payment_requested: true, items: [{ id: 'item-1', status: 'listo', quantity: 1 }] }];
        const { container, root } = await renderPage();
        expect(container.textContent).toContain('Cuenta solicitada');
        expect(container.querySelector('[data-testid="servicio-entregar-1"]')).not.toBeNull();
        await act(async () => root.unmount());
        container.remove();
    });

    it('preserves the legacy pending-payment status badge', async () => {
        mockRows.orders = [{ ...mockVisit, status: 'pendiente_pago', payment_requested: false }];
        const { container, root } = await renderPage();
        expect(container.textContent).toContain('Cuenta solicitada');
        await act(async () => root.unmount());
        container.remove();
    });

    it('keeps paid but unserved food serviceable and not closable', async () => {
        mockRows.orders = [{ ...mockVisit, items: [{ id: 'item-1', status: 'listo', quantity: 1 }] }];
        const { container, root } = await renderPage();
        expect(container.textContent).toContain('Entregar');
        expect(container.querySelector('[data-testid="servicio-cerrar-1"]')).toBeNull();
        await act(async () => root.unmount());
        container.remove();
    });

    it('offers explicit close for a cancelled active visit without recording a payment', async () => {
        mockRows.orders = [{ ...mockVisit, status: 'cancelado', payment_status: 'cancelado', amount_paid: 0, items: [{ id: 'item-1', status: 'cancelado', quantity: 1 }] }];
        const { container, root } = await renderPage();
        const button = container.querySelector('[data-testid="servicio-cerrar-1"]');
        expect(button).not.toBeNull();
        await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/attention/close');
        await act(async () => root.unmount());
        container.remove();
    });

    it('hides closure from roles not authorized by the server route', async () => {
        mockUser.role = 'cocina';
        const { container, root } = await renderPage();
        expect(container.querySelector('[data-testid="servicio-cerrar-1"]')).toBeNull();
        await act(async () => root.unmount());
        container.remove();
    });

    it('does not offer closure for an order from a historical visit', async () => {
        mockRows.tables = [{ ...mockTable, active_attention_id: 'visit-2' }];
        const { container, root } = await renderPage();
        expect(container.querySelector('[data-testid="servicio-cerrar-1"]')).toBeNull();
        expect(container.textContent).toContain('Visita activa');
        await act(async () => root.unmount());
        container.remove();
    });
});
