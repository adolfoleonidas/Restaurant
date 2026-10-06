/**
 * Después de confirmar, el carrito debe quedar en cero: si no, el cliente puede
 * volver a enviar el mismo pedido sin darse cuenta.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCart = [{ product_id: 'dish-1', name: 'Lomo saltado', quantity: 1, price: 32 }];
const mockClear = jest.fn();
const mockSetMeta = jest.fn();
const mockSearchParams = new URLSearchParams('?mesa=qr-token');
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
jest.mock('@/contexts/TableContext', () => ({ useTableContext: () => mockTableContext }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams],
}));

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
}

describe('el carrito queda en cero después de confirmar', () => {
    beforeEach(() => {
        sessionStorage.clear();
        mockClear.mockClear();
        mockSetMeta.mockClear();
        mockRefreshTable.mockClear();
        api.get.mockImplementation((path) => {
            if (path === '/public/restaurant') return Promise.resolve({ data: { require_table_qr: false, prepay: { prepay_required: false } } });
            if (path === '/public/payment-config') return Promise.resolve({ data: { enable_yape: true } });
            if (path === '/public/tables/resolve') return Promise.resolve({ data: { id: 'table-8', number: 8, area: 'Salón' } });
            return Promise.resolve({ data: null });
        });
        api.post.mockResolvedValue({
            data: {
                id: 'o1', tracking_code: 'T1', order_number: 9, total: 32, payment_method: 'yape',
                payment_state: 'no_requerido', prepay_required: false, sent_to_kitchen: true,
            },
        });
        Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'a8098c1a-f86e-41d8-b102-1b6f7c5f3a21' } });
        window.scrollTo = jest.fn();
    });
    afterEach(() => { document.body.innerHTML = ''; });

    it('vacía el carrito al confirmar', async () => {
        const { host, root } = await render();
        await click(host, 'checkout-confirmar-button');
        await click(host, 'checkout-pay-button');
        expect(mockClear).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('vacía el carrito aunque el guardado del seguimiento falle', async () => {
        mockSetMeta.mockImplementation(() => { throw new Error('sin almacenamiento'); });
        const { host, root } = await render();
        await click(host, 'checkout-confirmar-button');
        await click(host, 'checkout-pay-button');
        expect(mockClear).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('vacía el carrito aunque refrescar la mesa falle', async () => {
        mockRefreshTable.mockImplementation(() => { throw new Error('sin red'); });
        const { host, root } = await render();
        await click(host, 'checkout-confirmar-button');
        await click(host, 'checkout-pay-button');
        expect(mockClear).toHaveBeenCalled();
        await act(async () => root.unmount());
    });
});
