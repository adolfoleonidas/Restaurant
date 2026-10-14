/**
 * "Cobrar" en el salón lleva a cobrar.
 *
 * Antes abría `/pedidos/:id`, el detalle del pedido **con tomador de pedidos**:
 * el mozo pedía cobrar y aterrizaba en la carta, con el botón de cobro al final
 * de un scroll largo. La caja ya sabía abrir el cobro de una cuenta concreta por
 * `?order=` (lo usaba el detalle del pedido cuando no hay turno abierto), así que
 * el salón se suma a ese contrato.
 *
 * Este archivo prueba lo que ve el mozo: qué botón aparece, y a dónde va.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

var mockNavigate = jest.fn();
var mockUser = { id: 'mozo-1', role: 'mozo', functions: ['atencion', 'cobro'] };

const mockBillOrder = {
    id: 'order-4', order_number: 21, status: 'pendiente_pago', payment_requested: true,
    order_type: 'mesa', total: 45, amount_paid: 0, created_at: new Date().toISOString(), items: [],
};

const mockBillTable = {
    id: 'table-4', number: 4, name: 'Mesa 4', area: 'Salón', capacity: 4, status: 'esperando_pago',
    branch_id: 'branch-1', active_attention_id: null, qr_status: 'active', group: null, group_id: null,
    active_order: { id: 'order-4', order_number: 21, status: 'pendiente_pago', source: 'staff', total: 45, created_at: new Date().toISOString() },
};

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const source = String(fetcher);
        if (source.includes('listTables')) return { data: [mockBillTable], refetch: jest.fn() };
        if (source.includes('listOrders')) return { data: [mockBillOrder], refetch: jest.fn() };
        return { data: [], refetch: jest.fn() };
    },
}));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams()],
    useLocation: () => ({ pathname: '/salon' }),
    useParams: () => ({}),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

async function renderFloor() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Salon />); await Promise.resolve(); await Promise.resolve(); });
    return { container, root };
}

const click = async (element) => act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('cobrar desde el salón', () => {
    beforeEach(() => {
        api.get.mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockImplementation(() => Promise.resolve({ data: {} }));
        mockNavigate.mockReset();
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('el mozo con función de cobro va a la caja con esa cuenta', async () => {
        const { container, root } = await renderFloor();
        const cobrar = container.querySelector('[data-testid="mesa-card-cobrar-4"]');
        expect(cobrar).not.toBeNull();
        expect(cobrar.textContent).toContain('Cobrar');

        await click(cobrar);
        expect(mockNavigate).toHaveBeenCalledWith('/caja?order=order-4');
        await act(async () => root.unmount());
    });

    it('sin función de cobro el botón no existe: la mesa se paga en caja', async () => {
        mockUser = { id: 'mozo-2', role: 'mozo', functions: ['atencion'] };
        const { container, root } = await renderFloor();
        expect(container.querySelector('[data-testid="mesa-card-cobrar-4"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-4"]')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
