import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockVisit = {
    id: 'order-1', table_id: 'table-1', attention_id: 'visit-1', attention_state: 'open',
    acceptance_status: 'aceptado', attention_number: 5, attention_business_date: '2026-10-02', branch_id: 'branch-1',
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
    default: (fetcher) => /^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(fetcher.toString())
        ? { data: mockRows.tables, refetch: mockRefreshTables }
        : { data: mockRows.orders, refetch: mockRefreshOrders },
}));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a>, useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

describe('Servicio attention closure', () => {
    beforeEach(() => {
        mockUser.role = 'admin';
        mockRows.tables = [{ ...mockTable }];
        mockRows.orders = [{ ...mockVisit, items: [...mockVisit.items] }];
        mockRefreshTables.mockClear();
        mockRefreshOrders.mockClear();
        // El salón lee el catálogo de sucursales para saber qué piso muestra.
        api.get.mockReset().mockImplementation((path) => Promise.resolve({ data: path === '/branches' ? [] : null }));
        api.post.mockReset().mockResolvedValue({ data: { status: 'closed' } });
        toast.error.mockClear();
        toast.success.mockClear();
    });

    it('shows active no-table pickups and keeps prior-day ready pickups collapsed and inspectable', async () => {
        mockRows.orders = [
            ...mockRows.orders,
            { id: 'pickup-today', order_number: 55, order_type: 'recojo', status: 'listo', ready_at: new Date().toISOString(), items: [] },
            { id: 'pickup-working', order_number: 56, order_type: 'recojo', status: 'en_preparacion', items: [] },
            { id: 'pickup-old', order_number: 57, order_type: 'recojo', status: 'listo', ready_at: '2000-01-01T10:00:00Z', items: [] },
        ];
        const { container, root } = await renderPage();
        expect(container.querySelector('[data-testid="servicio-recojos-activos"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="servicio-recojo-pickup-today"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="servicio-recojo-pickup-working"]')).not.toBeNull();
        const history = container.querySelector('[data-testid="servicio-dias-anteriores"]');
        expect(history).not.toBeNull();
        expect(history.open).toBe(false);
        expect(history.textContent).toContain('Pedido #57');
        expect(history.querySelector('a[href="/pedidos/pickup-old"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        await act(async () => root.unmount());
        container.remove();
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
        expect(container.textContent).toContain('Atención 5 · 2026-10-02 · branch-1');
        expect(container.querySelector('[data-testid="mesa-card-deliver-1"]')).not.toBeNull();
        await act(async () => root.unmount());
        container.remove();
    });

    it('surfaces a legacy pending-payment account as the state, not as a badge', async () => {
        // `status = "pendiente_pago"` es la codificación antigua de «pidió la
        // cuenta». Antes la tarjeta decía «Ocupada» y añadía la insignia «Cuenta
        // solicitada», porque el estado salía de la copia de la mesa (que en este
        // caso no trae cuenta) y no de la cuenta sobre la que actúan los botones.
        // Ahora el estado sale de esa cuenta y lo dice él mismo: el dato no se
        // pierde, se pinta donde corresponde y la insignia deja de repetirlo.
        mockRows.orders = [{ ...mockVisit, status: 'pendiente_pago', payment_requested: false }];
        const { container, root } = await renderPage();
        expect(container.textContent).toContain('Cuenta');
        expect(container.querySelector('[data-testid="mesa-card-cobrar-1"]')).not.toBeNull();
        // Y no se duplica: la insignia solo aparece cuando el estado no lo dice.
        expect(container.textContent).not.toContain('Cuenta solicitada');
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
