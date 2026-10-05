import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Pedidos from '@/pages/Pedidos';
import Caja from '@/pages/Caja';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
let mockRole = 'admin';
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: mockRole } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [new URLSearchParams()],
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const fifteenMinAgo = new Date(now - 15 * 60 * 1000).toISOString();
const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString();

const baseOrder = (overrides) => ({
    id: 'order-1',
    order_number: 10,
    order_type: 'mesa',
    status: 'pendiente_pago',
    payment_status: 'pendiente',
    created_at: fiveMinAgo,
    total: 80,
    amount_paid: 0,
    items: [{ id: 'i1', product_name: 'Lomo', quantity: 2, unit_price: 40, subtotal: 80 }],
    ...overrides,
});

let mockOrders = [];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: () => ({ data: mockOrders }),
}));

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

describe('T05 Orders list clarity', () => {
    let host, root;
    beforeEach(() => {
        api.get.mockReset().mockResolvedValue({ data: [] });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    it('shows a prominent "Cobrar" action for orders pending payment', async () => {
        mockOrders = [baseOrder({ id: 'o-pend', order_number: 42, status: 'pendiente_pago', payment_status: 'pendiente' })];
        await act(async () => root.render(<Pedidos />));
        await flush();
        const cobrarBtn = host.querySelector('[data-testid="pedidos-cobrar-42"]');
        expect(cobrarBtn).not.toBeNull();
        expect(cobrarBtn.textContent).toMatch(/Cobrar/);
    });

    it('shows "Verificar comprobante" when payment proof is uploaded', async () => {
        mockOrders = [baseOrder({
            id: 'o-proof',
            order_number: 55,
            status: 'pendiente_pago',
            payment_status: 'comprobante_subido',
            payment_proof_method: 'yape',
        })];
        await act(async () => root.render(<Pedidos />));
        await flush();
        expect(host.textContent).toContain('Verificar comprobante');
        const verifyBtn = host.querySelector('[data-testid="pedidos-verificar-55"]');
        expect(verifyBtn).not.toBeNull();
    });

    it('shows remaining balance for partially paid orders', async () => {
        mockOrders = [baseOrder({
            id: 'o-parc',
            order_number: 77,
            status: 'entregado',
            payment_status: 'parcial',
            total: 100,
            amount_paid: 40,
        })];
        await act(async () => root.render(<Pedidos />));
        await flush();
        expect(host.textContent).toContain('S/ 60.00');
        expect(host.textContent).toMatch(/resta/i);
    });

    it('highlights orders waiting more than 15 minutes', async () => {
        mockOrders = [baseOrder({
            id: 'o-old',
            order_number: 88,
            status: 'pendiente_pago',
            created_at: thirtyMinAgo,
        })];
        await act(async () => root.render(<Pedidos />));
        await flush();
        const card = host.querySelector('[data-testid="pedidos-card-88"]');
        expect(card).not.toBeNull();
        expect(card.className).toMatch(/pedidos-card-waiting/);
    });

    it('does not add waiting highlight for recent orders', async () => {
        mockOrders = [baseOrder({
            id: 'o-new',
            order_number: 99,
            status: 'pendiente_pago',
            created_at: fiveMinAgo,
        })];
        await act(async () => root.render(<Pedidos />));
        await flush();
        const card = host.querySelector('[data-testid="pedidos-card-99"]');
        expect(card).not.toBeNull();
        expect(card.className).not.toMatch(/pedidos-card-waiting/);
    });

    it('shows "Pagado" state clearly for fully paid orders', async () => {
        mockOrders = [baseOrder({
            id: 'o-paid',
            order_number: 33,
            status: 'pagado',
            payment_status: 'pagado',
            total: 50,
            amount_paid: 50,
        })];
        await act(async () => root.render(<Pedidos />));
        await flush();
        expect(host.textContent).toMatch(/Pagado/);
        const cobrarBtn = host.querySelector('[data-testid="pedidos-cobrar-33"]');
        expect(cobrarBtn).toBeNull();
    });
});

// --- Caja payment history tests ---

const mockRegister = {
    id: 'reg-1', status: 'open', opened_by_name: 'Ada', opened_at: '2026-10-01T10:00:00Z',
    opening_amount: 100, expected_amount: 200, cash_sales: 100,
    by_method: { yape: 50, tarjeta: 30 },
};

const mockPayments = [
    { id: 'pay-1', order_id: 'o1', order_number: 10, method: 'efectivo', amount: 50, status: 'completed', created_at: '2026-10-02T11:00:00Z', paid_by_name: 'Ada' },
    { id: 'pay-2', order_id: 'o2', order_number: 11, method: 'yape', amount: 30, status: 'completed', created_at: '2026-10-02T11:30:00Z', paid_by_name: 'Ada' },
    { id: 'pay-3', order_id: 'o3', order_number: 12, method: 'tarjeta', amount: 20, status: 'voided', created_at: '2026-10-02T12:00:00Z', paid_by_name: 'Ada', void_reason: 'Error de cobro' },
];

describe('T05 Caja payment history clarity', () => {
    let host, root;

    beforeEach(() => {
        mockRole = 'cajero';
        api.get.mockReset().mockImplementation((path) => {
            if (path === '/cash/current') return Promise.resolve({ data: mockRegister });
            if (path.startsWith('/payments')) return Promise.resolve({ data: mockPayments });
            if (path.startsWith('/orders')) return Promise.resolve({ data: [] });
            if (path.startsWith('/tables')) return Promise.resolve({ data: [] });
            return Promise.resolve({ data: null });
        });
        api.post.mockReset();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
        mockRole = 'admin';
    });

    it('shows totals by payment method in the payment history', async () => {
        await act(async () => root.render(<Caja />));
        await flush();
        // Navigate to history tab
        await act(async () => {
            const histBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Historial');
            histBtn?.click();
        });
        await flush();
        // Should show method totals
        expect(host.textContent).toMatch(/Efectivo/);
        expect(host.textContent).toMatch(/S\/ 50\.00/);
    });

    it('visually distinguishes voided payments', async () => {
        await act(async () => root.render(<Caja />));
        await flush();
        await act(async () => {
            const histBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Historial');
            histBtn?.click();
        });
        await flush();
        const voidedPayment = host.querySelector('[data-testid="caja-pago-pay-3"]');
        expect(voidedPayment).not.toBeNull();
        expect(voidedPayment.className).toMatch(/caja-pago-voided/);
        expect(host.textContent).toContain('Anulado');
    });
});
