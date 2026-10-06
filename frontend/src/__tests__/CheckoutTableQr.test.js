/**
 * Flujo del cliente al escanear el QR de una mesa.
 *
 * Se cubre lo que ve y decide el cliente: la mesa llega en contexto, el pedido
 * se revisa antes de cobrar y el prepago se muestra como "pago pendiente" hasta
 * que el restaurante lo confirma.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCart = [{ product_id: 'dish-1', name: 'Lomo saltado', quantity: 1, price: 32 }];
const mockClear = jest.fn();
const mockSetMeta = jest.fn();
const mockSearchParams = new URLSearchParams('?mesa=qr-token');
// Las fábricas de jest.mock se elevan sobre las constantes del módulo, así que
// los dobles viven en `var` y el valor del contexto es un objeto estable: si
// cada render devolviera uno nuevo, el efecto del checkout se dispararía sin fin.
var mockRefreshTable = jest.fn(() => Promise.resolve(null));
var mockTableContext = {
    token: 'qr-token',
    table: { id: 'table-8', number: 8, area: 'Salón' },
    session: { open: true, orders: [], total_paid: 0, total_pending: 0 },
    policy: null,
    hasTable: true,
    loading: false,
    error: '',
    refresh: (...args) => mockRefreshTable(...args),
    clearTable: () => {},
};

jest.mock('@/contexts/CartContext', () => ({
    useCart: () => ({ items: mockCart, subtotal: 32, clear: mockClear }),
}));
jest.mock('@/contexts/LiveOrderContext', () => ({
    useLiveOrder: () => ({ setMeta: mockSetMeta, isActive: false }),
}));
jest.mock('@/contexts/TableContext', () => ({
    useTableContext: () => mockTableContext,
}));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams],
}));

const PREPAY_POLICY = {
    prepay_mode: 'always',
    prepay_required: true,
    prepay_table: true,
    prepay_pickup: false,
    prepay_delivery: false,
    verify_methods: ['yape', 'plin', 'transferencia'],
};

function mockApi({ prepay = PREPAY_POLICY, paymentConfig = { enable_yape: true, yape_number: '999', yape_holder: 'Casa' } } = {}) {
    api.get.mockImplementation((path) => {
        if (path === '/public/restaurant') return Promise.resolve({ data: { require_table_qr: false, prepay } });
        if (path === '/public/payment-config') return Promise.resolve({ data: paymentConfig });
        if (path === '/public/tables/resolve') return Promise.resolve({ data: { id: 'table-8', number: 8, area: 'Salón' } });
        if (path === '/public/tables') return Promise.resolve({ data: [] });
        if (path === '/public/pickup-branches') return Promise.resolve({ data: [{ id: 'branch-a', name: 'Centro' }] });
        if (path === '/public/delivery-branches') return Promise.resolve({ data: [{ id: 'branch-a', name: 'Centro' }] });
        return Promise.resolve({ data: null });
    });
}

async function render() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Checkout />); await Promise.resolve(); await Promise.resolve(); });
    return { host, root };
}

async function click(host, testId) {
    const node = host.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    return node;
}

// Radix resuelve sus pestañas con pointerdown/mousedown, no con un click suelto.
async function selectTab(host, testId) {
    const node = host.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    await act(async () => {
        node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
    });
    return node;
}

describe('checkout con QR de mesa', () => {
    beforeEach(() => {
        sessionStorage.clear();
        mockClear.mockClear();
        mockSetMeta.mockClear();
        mockRefreshTable.mockClear();
        toast.success.mockClear();
        toast.error.mockClear();
        api.post.mockReset();
        Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'a8098c1a-f86e-41d8-b102-1b6f7c5f3a21' } });
        window.scrollTo = jest.fn();
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('muestra la mesa del QR preseleccionada sin volver a pedirla', async () => {
        mockApi();
        const { host, root } = await render();
        expect(host.querySelector('[data-testid="checkout-mesa-preseleccionada"]').textContent).toBe('8');
        expect(host.textContent).toContain('Del QR');
        await act(async () => root.unmount());
    });

    it('revisa el pedido antes de cobrar y muestra modalidad, mesa y total', async () => {
        mockApi();
        const { host, root } = await render();
        await click(host, 'checkout-confirmar-button');
        expect(api.post).not.toHaveBeenCalled();
        const review = host.querySelector('[data-testid="checkout-review-root"]');
        expect(review).not.toBeNull();
        expect(review.textContent).toContain('Lomo saltado');
        expect(review.textContent).toContain('Mesa 8');
        expect(review.textContent).toContain('Comer en local');
        expect(host.querySelector('[data-testid="checkout-review-total"]').textContent).toBe('S/ 32.00');
        await act(async () => root.unmount());
    });

    it('con prepago avisa que se paga antes de preparar y cobra al confirmar', async () => {
        mockApi();
        api.post.mockResolvedValue({
            data: {
                id: 'order-1', tracking_code: 'TRACK1', order_number: 1042, total: 32,
                payment_method: 'yape', payment_state: 'pendiente', prepay_required: true,
                sent_to_kitchen: false, status: 'enviado_cocina',
            },
        });
        const { host, root } = await render();
        await click(host, 'checkout-confirmar-button');
        expect(host.querySelector('[data-testid="checkout-prepay-warning"]')).not.toBeNull();
        const pay = host.querySelector('[data-testid="checkout-pay-button"]');
        expect(pay.textContent).toContain('Pagar S/ 32.00');

        await click(host, 'checkout-pay-button');
        expect(api.post).toHaveBeenCalledWith('/public/orders', expect.objectContaining({ payment_method: 'yape', table_token: 'qr-token' }));
        expect(host.querySelector('[data-testid="checkout-result-title"]').textContent).toBe('Pendiente de pago');
        expect(host.querySelector('[data-testid="checkout-payment-state"]').getAttribute('data-payment-state')).toBe('pendiente');
        expect(host.textContent).toContain('Cuando el restaurante confirme el pago, pasa a cocina');
        await act(async () => root.unmount());
    });

    it('sin prepago confirma y el pedido va a cocina', async () => {
        mockApi({ prepay: { ...PREPAY_POLICY, prepay_required: false, prepay_mode: 'never' } });
        api.post.mockResolvedValue({
            data: {
                id: 'order-2', tracking_code: 'TRACK2', order_number: 1043, total: 32,
                payment_method: 'yape', payment_state: 'no_requerido', prepay_required: false,
                sent_to_kitchen: true, status: 'enviado_cocina',
            },
        });
        const { host, root } = await render();
        await click(host, 'checkout-confirmar-button');
        expect(host.querySelector('[data-testid="checkout-prepay-warning"]')).toBeNull();
        expect(host.querySelector('[data-testid="checkout-pay-button"]').textContent).toContain('Confirmar pedido');
        await click(host, 'checkout-pay-button');
        expect(host.querySelector('[data-testid="checkout-result-title"]').textContent).toBe('Pago confirmado ✓');
        expect(host.textContent).toContain('Pedido #1043 enviado a cocina');
        await act(async () => root.unmount());
    });

    it('con prepago en efectivo el pedido va a cocina y se cobra en caja', async () => {
        // Yape queda habilitado para que siga siendo el método preseleccionado y
        // el test elija efectivo explícitamente.
        mockApi({ prepay: PREPAY_POLICY, paymentConfig: { enable_efectivo: true, enable_yape: true } });
        api.post.mockResolvedValue({
            data: {
                id: 'order-3', tracking_code: 'TRACK3', order_number: 1044, total: 32,
                payment_method: 'efectivo', payment_state: 'pendiente', prepay_required: true,
                pay_at_counter: true, sent_to_kitchen: true, status: 'enviado_cocina',
            },
        });
        const { host, root } = await render();
        await selectTab(host, 'checkout-method-efectivo');
        await act(async () => { await Promise.resolve(); });
        expect(host.querySelector('[data-testid="checkout-method-efectivo"]').getAttribute('data-state')).toBe('active');
        await click(host, 'checkout-confirmar-button');
        expect(host.querySelector('[data-testid="checkout-review-root"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="checkout-pay-counter-warning"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="checkout-prepay-warning"]')).toBeNull();
        await click(host, 'checkout-pay-button');
        expect(host.textContent).toContain('Se cobra en caja');
        expect(host.querySelector('[data-testid="checkout-result-title"]').textContent).toBe('Pago confirmado ✓');
        await act(async () => root.unmount());
    });

    it('el cliente puede cambiar a recojo aunque haya escaneado el QR', async () => {
        mockApi({ prepay: { ...PREPAY_POLICY, prepay_pickup: true } });
        api.post.mockResolvedValue({
            data: {
                id: 'order-4', tracking_code: 'TRACK4', order_number: 1045, total: 32,
                payment_method: 'efectivo', payment_state: 'no_requerido', prepay_required: false,
                sent_to_kitchen: true, status: 'enviado_cocina',
            },
        });
        const { host, root } = await render();
        await click(host, 'checkout-tipo-recojo');
        // El cambio de modalidad dispara la carga de sucursales: hay que dejar
        // que ese efecto termine antes de mirar la pantalla.
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
        expect(host.querySelector('[data-testid="checkout-pickup-branch"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="checkout-mesa-preseleccionada"]')).toBeNull();
        await act(async () => {
            const select = host.querySelector('[data-testid="checkout-pickup-branch"]');
            select.value = 'branch-a';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        // Recojo exige nombre y celular para poder entregar el pedido.
        await act(async () => {
            for (const [testId, value] of [['checkout-nombre', 'Ana'], ['checkout-celular', '999888777']]) {
                const input = host.querySelector(`[data-testid="${testId}"]`);
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await Promise.resolve();
        });
        await click(host, 'checkout-confirmar-button');
        expect(host.querySelector('[data-testid="checkout-review-root"]')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
