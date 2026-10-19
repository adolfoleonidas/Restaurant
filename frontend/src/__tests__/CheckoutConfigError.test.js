/**
 * Checkout needs the restaurant and the payment config to know which methods to
 * offer. If either fetch fails the page must say so and offer a retry, instead of
 * leaving the submit button silently disabled.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCart = [{ product_id: 'dish-1', name: 'Lomo saltado', quantity: 1, price: 32 }];
const mockSearchParams = new URLSearchParams('');
// Stable objects/functions: a new value on every render would re-fire the effects.
var mockTableContext = {
    token: '', table: null, session: null, policy: null, hasTable: false, loading: false, error: '',
    refresh: () => Promise.resolve(null), clearTable: () => {},
};
var mockCartValue = { items: mockCart, subtotal: 32, clear: () => {} };
var mockLiveOrder = { setMeta: () => {}, isActive: false };

jest.mock('@/contexts/CartContext', () => ({ useCart: () => mockCartValue }));
jest.mock('@/contexts/LiveOrderContext', () => ({ useLiveOrder: () => mockLiveOrder }));
jest.mock('@/contexts/TableContext', () => ({ useTableContext: () => mockTableContext }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams],
}));

let failRestaurant;
let failPaymentConfig;

function mockApi() {
    api.get.mockImplementation((path) => {
        if (path === '/public/restaurant') {
            return failRestaurant
                ? Promise.reject(new Error('Network Error'))
                : Promise.resolve({ data: { require_table_qr: false, prepay: null } });
        }
        if (path === '/public/payment-config') {
            return failPaymentConfig
                ? Promise.reject(new Error('Network Error'))
                : Promise.resolve({ data: { enable_efectivo: true } });
        }
        if (path === '/public/tables') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: null });
    });
}

const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

async function render() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Checkout />); await settle(); });
    return { host, root };
}

const q = (host, id) => host.querySelector(`[data-testid="${id}"]`);

describe('checkout when the configuration fetches fail', () => {
    beforeEach(() => {
        failRestaurant = false;
        failPaymentConfig = false;
        api.get.mockReset();
        window.scrollTo = jest.fn();
    });
    afterEach(() => { document.body.innerHTML = ''; });

    it('shows no error when both fetches succeed', async () => {
        mockApi();
        const { host, root } = await render();
        expect(q(host, 'checkout-config-error')).toBeNull();
        await act(async () => root.unmount());
    });

    it.each([
        ['the restaurant', () => { failRestaurant = true; }],
        ['the payment config', () => { failPaymentConfig = true; }],
    ])('shows a message and a retry button when %s cannot be loaded', async (_label, fail) => {
        fail();
        mockApi();
        const { host, root } = await render();
        expect(q(host, 'checkout-config-error')).not.toBeNull();
        expect(q(host, 'checkout-config-error').textContent).toMatch(/conexión/i);
        expect(q(host, 'checkout-config-retry')).not.toBeNull();
        await act(async () => root.unmount());
    });

    it('retry reloads the configuration and clears the error once it succeeds', async () => {
        failPaymentConfig = true;
        mockApi();
        const { host, root } = await render();
        expect(q(host, 'checkout-config-error')).not.toBeNull();

        failPaymentConfig = false;
        await act(async () => {
            q(host, 'checkout-config-retry').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await settle();
        });
        expect(q(host, 'checkout-config-error')).toBeNull();
        expect(q(host, 'checkout-confirmar-button')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
