/**
 * La revisión del pedido muestra la mesa elegida en el selector, no "Sin definir".
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCart = [{ product_id: 'dish-1', name: 'Lomo saltado', quantity: 1, price: 32 }];
const mockSearchParams = new URLSearchParams('');
var mockTableContext = {
    token: '', table: null, session: null, policy: null, hasTable: false, loading: false, error: '',
    refresh: () => Promise.resolve(null), clearTable: () => {},
};

jest.mock('@/contexts/CartContext', () => ({
    useCart: () => ({ items: mockCart, subtotal: 32, clear: jest.fn() }),
}));
jest.mock('@/contexts/LiveOrderContext', () => ({
    useLiveOrder: () => ({ setMeta: jest.fn(), isActive: false }),
}));
jest.mock('@/contexts/TableContext', () => ({ useTableContext: () => mockTableContext }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams],
}));

describe('checkout review with a table picked from the picker', () => {
    it('shows the picked table instead of "Sin definir"', async () => {
        api.get.mockImplementation((path) => {
            if (path === '/public/restaurant') return Promise.resolve({ data: { require_table_qr: false } });
            if (path === '/public/payment-config') return Promise.resolve({ data: { enable_yape: true, yape_number: '999', yape_holder: 'Casa' } });
            if (path === '/public/tables') return Promise.resolve({ data: [{ id: 'table-5', number: 5, status: 'disponible', capacity: 4 }] });
            return Promise.resolve({ data: [] });
        });
        window.scrollTo = jest.fn();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => { root.render(<Checkout />); await Promise.resolve(); await Promise.resolve(); });
        const tick = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
        await tick();
        await act(async () => host.querySelector('[data-testid="checkout-mesa-5"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await tick();
        await act(async () => host.querySelector('[data-testid="checkout-confirmar-button"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await tick();
        const review = host.querySelector('[data-testid="checkout-review-root"]');
        expect(review).not.toBeNull();
        expect(review.textContent).toContain('Mesa 5');
        expect(review.textContent).not.toContain('Sin definir');
        await act(async () => root.unmount());
        host.remove();
    });
});
