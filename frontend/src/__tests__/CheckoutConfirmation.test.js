import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCheckoutItems = [{ product_id: 'dish-1', name: 'Sopa', quantity: 1, price: 25 }];
const mockClearCart = jest.fn();
const mockSetMeta = jest.fn();
const originalCrypto = window.crypto;
const mockSearchParams = new URLSearchParams('?mesa=qr-token');

jest.mock('@/contexts/CartContext', () => ({
    useCart: () => ({ items: mockCheckoutItems, subtotal: 25, clear: mockClearCart }),
}));
jest.mock('@/contexts/LiveOrderContext', () => ({
    useLiveOrder: () => ({ setMeta: mockSetMeta, isActive: false }),
}));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams],
}));

async function renderCheckout() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<Checkout />);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { container, root };
}

describe('Checkout confirmed-order persistence', () => {
    let removeItem;

    beforeEach(() => {
        sessionStorage.clear();
        Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'a8098c1a-f86e-41d8-b102-1b6f7c5f3a21' } });
        mockClearCart.mockClear();
        mockSetMeta.mockClear();
        toast.success.mockClear();
        toast.error.mockClear();
        api.get.mockImplementation((path) => {
            if (path === '/public/restaurant') return Promise.resolve({ data: { require_table_qr: false } });
            if (path === '/public/payment-config') return Promise.resolve({ data: { enable_yape: true, yape_number: '999000111', yape_holder: 'Restaurant' } });
            if (path === '/public/tables/resolve') return Promise.resolve({ data: { id: 'table-1', number: 1, area: 'Salon' } });
            return Promise.resolve({ data: [] });
        });
        api.post.mockResolvedValue({ data: { tracking_code: 'owner-code', order_number: 17, total: 25, payment_method: 'yape', acceptance_status: 'aceptado', attention_number: 2, attention_business_date: '2026-10-02' } });
        window.scrollTo = jest.fn();
        removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('session storage cleanup unavailable');
        });
    });

    afterEach(() => {
        removeItem.mockRestore();
        Object.defineProperty(window, 'crypto', { configurable: true, value: originalCrypto });
    });

    it('shows the owner tracking confirmation even when session storage cleanup throws after POST success', async () => {
        const { container, root } = await renderCheckout();
        expect(container.textContent).toContain('Mesa 1');
        // El flujo tiene dos pasos: revisar el pedido y recién ahí confirmar/pagar.
        await act(async () => {
            container.querySelector('[data-testid="checkout-confirmar-button"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(container.querySelector('[data-testid="checkout-review-root"]')).not.toBeNull();
        await act(async () => {
            container.querySelector('[data-testid="checkout-pay-button"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(api.post).toHaveBeenCalledWith('/public/orders', expect.objectContaining({ request_id: expect.any(String) }));
        expect(removeItem).toHaveBeenCalled();
        expect(container.querySelector('[data-testid="checkout-confirmed-root"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="checkout-tracking-code"]').textContent).toBe('owner-code');
        expect(container.textContent).toContain('Atención 2');
        expect(container.textContent).toContain('2026-10-02');
        expect(toast.success).toHaveBeenCalledWith('Pedido #17 guardado: falta el pago');
        expect(mockClearCart).toHaveBeenCalled();

        await act(async () => root.unmount());
        container.remove();
    });
});
