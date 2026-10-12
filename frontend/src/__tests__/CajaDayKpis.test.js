/**
 * Caja / Cobro — paridad con el prototipo (Slice 4):
 * - S4-1: KPIs del día (Ventas de hoy / Cuentas cobradas / Ticket promedio /
 *   Por cobrar) desde los datos ya cargados de la página.
 * - S4-2: minutos transcurridos y botón "Ver" en cada cuenta abierta.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Caja from '@/pages/Caja';
import { api } from '@/lib/api';

const mockRegister = {
    id: 'reg-1', status: 'open', opened_by_name: 'Ada', opened_at: '2026-10-01T10:00:00Z',
    opening_amount: 100, expected_amount: 200, cash_sales: 100, by_method: { yape: 50 },
};
const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const mockOrders = [
    {
        id: 'order-1', order_number: 10, status: 'entregado', payment_status: 'parcial',
        total: 80, amount_paid: 20, created_at: thirtyMinAgo,
        items: [{ id: 'i1', product_name: 'Lomo', quantity: 1, unit_price: 80, subtotal: 80, status: 'entregado' }],
    },
    {
        id: 'order-2', order_number: 11, status: 'pendiente_pago', payment_status: 'pendiente',
        payment_requested: true, total: 50, amount_paid: 0, created_at: thirtyMinAgo,
        items: [{ id: 'i2', product_name: 'Sopa', quantity: 1, unit_price: 50, subtotal: 50, status: 'listo' }],
    },
];
const mockPayments = [
    { id: 'pay-1', order_id: 'order-1', order_number: 10, method: 'efectivo', amount: 50, status: 'completed', created_at: '2026-10-02T11:00:00Z', paid_by_name: 'Ada' },
    { id: 'pay-2', order_id: 'order-2', order_number: 11, method: 'yape', amount: 30, status: 'completed', created_at: '2026-10-02T11:30:00Z', paid_by_name: 'Ada' },
    { id: 'pay-3', order_id: 'order-2', order_number: 11, method: 'tarjeta', amount: 20, status: 'voided', created_at: '2026-10-02T12:00:00Z', paid_by_name: 'Ada' },
];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'cashier-1', restaurant_id: 'restaurant-1', role: 'cajero' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useSearchParams: () => [new URLSearchParams()],
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = fetcher.toString();
        if (src.includes('/cash/current')) return { data: mockRegister, refetch: jest.fn() };
        if (src.includes('/payments')) return { data: mockPayments, refetch: jest.fn() };
        if (src.includes('/orders')) return { data: mockOrders, refetch: jest.fn() };
        if (src.includes('/tables')) return { data: [], refetch: jest.fn() };
        return { data: null, refetch: jest.fn() };
    },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    api.get.mockReset().mockImplementation(() => Promise.resolve({ data: null }));
    api.post.mockReset();
});

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

async function renderCaja() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Caja />));
    await flush();
    return { host, root };
}

describe('Caja · KPIs del día (S4-1)', () => {
    let host;
    let root;

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    it('resume ventas, cobros, ticket promedio y por cobrar', async () => {
        ({ host, root } = await renderCaja());

        // Ventas: 50 + 30 (el cobro anulado no cuenta). Promedio: 80 / 2.
        expect(host.querySelector('[data-testid="caja-kpi-ventas"]').textContent).toContain('S/ 80.00');
        expect(host.querySelector('[data-testid="caja-kpi-cobros"]').textContent).toContain('2');
        expect(host.querySelector('[data-testid="caja-kpi-promedio"]').textContent).toContain('S/ 40.00');
        // Por cobrar: (80 - 20) + (50 - 0).
        expect(host.querySelector('[data-testid="caja-kpi-por-cobrar"]').textContent).toContain('S/ 110.00');
    });
});

describe('Caja · cuentas abiertas (S4-2)', () => {
    let host;
    let root;

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    it('muestra los minutos transcurridos y el botón Ver de cada cuenta', async () => {
        ({ host, root } = await renderCaja());

        const row = host.querySelector('[data-testid="caja-pedido-10"]');
        expect(row).not.toBeNull();
        expect(row.textContent).toContain('30 min');

        const ver = host.querySelector('[data-testid="caja-ver-10"]');
        expect(ver).not.toBeNull();
        expect(ver.textContent).toContain('Ver');
        expect(ver.getAttribute('href')).toBe('/pedidos/order-1');

        // El botón Cobrar existente y su testid no cambian.
        expect(host.querySelector('[data-testid="caja-cobrar-10"]')).not.toBeNull();
    });
});
