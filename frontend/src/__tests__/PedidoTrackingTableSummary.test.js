/**
 * El seguimiento de un pedido muestra la mesa completa.
 *
 * El enlace de seguimiento se comparte y se abre sin el `?mesa=` del QR, así que
 * el resumen no puede depender del contexto guardado en el teléfono: se resuelve
 * por el propio pedido.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PedidoTracking from '@/pages/PedidoTracking';
import { api } from '@/lib/api';

let mockTrackedOrder;
let mockTableSummary;

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    useParams: () => ({ code: 'TRACK-1' }),
    useNavigate: () => jest.fn(),
    Link: ({ children, to }) => <a href={to}>{children}</a>,
}));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: () => ({ data: mockTrackedOrder, loading: false, error: null, refetch: jest.fn() }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/contexts/LiveOrderContext', () => ({
    useLiveOrder: () => ({ clearMeta: jest.fn(), meta: null, isActive: false }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('resumen de la mesa en el seguimiento', () => {
    let host;
    let root;

    beforeEach(() => {
        mockTrackedOrder = {
            id: 'order-2', order_number: 1051, tracking_code: 'TRACK-1', status: 'enviado_cocina',
            order_type: 'local', table_id: 'mesa-8', acceptance_status: 'aceptado',
            payment_status: 'pendiente', payment_state: 'pendiente', prepay_required: true,
            pay_at_counter: false, items: [{ id: 'i1', product_name: 'Inca Kola', quantity: 1, subtotal: 14 }],
        };
        mockTableSummary = {
            table: { id: 'mesa-8', number: 8, area: 'Salón' },
            session: {
                open: true,
                total_paid: 35,
                total_pending: 14,
                orders: [
                    {
                        id: 'order-1', order_number: 1042, tracking_code: 'T-1042', status: 'en_preparacion',
                        total: 35, paid: true, payment_state: 'confirmado', acceptance_status: 'aceptado',
                        item_count: 2, items: [
                            { name: 'Lomo saltado', quantity: 1, notes: 'sin cebolla' },
                            { name: 'Chicha morada', quantity: 1, notes: null },
                        ],
                    },
                    {
                        id: 'order-2', order_number: 1051, tracking_code: 'TRACK-1', status: 'enviado_cocina',
                        total: 14, paid: false, payment_state: 'pendiente', acceptance_status: 'pendiente',
                        item_count: 1, items: [{ name: 'Inca Kola', quantity: 1, notes: null }],
                    },
                ],
            },
            policy: { prepay_required: true },
        };
        api.get.mockImplementation((path) => {
            if (path === '/public/orders/TRACK-1/table') return Promise.resolve({ data: mockTableSummary });
            if (path === '/public/restaurant') return Promise.resolve({ data: { name: 'Sabor' } });
            return Promise.resolve({ data: {} });
        });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    const render = async () => {
        await act(async () => { root.render(<PedidoTracking />); await Promise.resolve(); await Promise.resolve(); });
    };

    it('lista todos los pedidos de la mesa, no solo el abierto', async () => {
        await render();
        expect(api.get).toHaveBeenCalledWith('/public/orders/TRACK-1/table');
        const panel = host.querySelector('[data-testid="table-session-panel"]');
        expect(panel).not.toBeNull();
        expect(panel.textContent).toContain('Mesa 8');
        expect(host.querySelector('[data-testid="table-session-order-1042"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="table-session-order-1051"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="table-session-paid"]').textContent).toContain('35.00');
        expect(host.querySelector('[data-testid="table-session-pending"]').textContent).toContain('14.00');
    });

    it('muestra los productos y las observaciones de cada pedido', async () => {
        await render();
        const primero = host.querySelector('[data-testid="table-session-order-1042-items"]');
        expect(primero.textContent).toContain('Lomo saltado');
        expect(primero.textContent).toContain('sin cebolla');
        expect(primero.textContent).toContain('Chicha morada');
        const segundo = host.querySelector('[data-testid="table-session-order-1051-items"]');
        expect(segundo.textContent).toContain('Inca Kola');
    });

    it('señala cuál de los pedidos se está viendo', async () => {
        await render();
        const abierto = host.querySelector('[data-testid="table-session-order-1051"]');
        const otro = host.querySelector('[data-testid="table-session-order-1042"]');
        expect(abierto.textContent).toContain('Estás viendo este');
        expect(otro.textContent).not.toContain('Estás viendo este');
    });

    it('no muestra el resumen en un pedido que no es de mesa', async () => {
        mockTrackedOrder = { ...mockTrackedOrder, order_type: 'delivery', table_id: null };
        await render();
        expect(host.querySelector('[data-testid="table-session-panel"]')).toBeNull();
    });

    it('deja seguir pidiendo algo más desde el resumen', async () => {
        await render();
        expect(host.querySelector('[data-testid="table-session-order-more"]')).not.toBeNull();
    });
});
