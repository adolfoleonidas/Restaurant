import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Login from '@/pages/Login';
import Landing from '@/pages/Landing';
import { PublicLayout } from '@/components/PublicLayout';
import { api } from '@/lib/api';

jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    Outlet: () => null,
    Navigate: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/login', state: null }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, login: jest.fn() }) }));
jest.mock('@/contexts/CartContext', () => ({ useCart: () => ({ count: 0, subtotal: 0, items: [], addProduct: jest.fn(), updateQty: jest.fn() }) }));
jest.mock('@/contexts/LiveOrderContext', () => ({ useLiveOrder: () => ({ isActive: false, mode: 'cart', order: null, clearMeta: jest.fn() }) }));
jest.mock('@/hooks/usePolling', () => () => ({ data: { name: 'Sabor Peruano' } }));
jest.mock('@/hooks/usePublicStream', () => () => ({ generation: 0 }));
jest.mock('@/components/CartPanel', () => ({ CartPanel: () => null }));
jest.mock('@/components/ProductCard', () => ({ ProductCard: ({ product }) => <article>{product.name}</article> }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('public entry and navigation regressions', () => {
    beforeEach(() => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path.endsWith('restaurant')
                ? { id: 1, name: 'Sabor Peruano' }
                : path.endsWith('categories')
                    ? [{ id: 1, slug: 'platos', name: 'Platos' }]
                    : [{ id: 1, category_id: 1, name: 'Chicharrón', description: '', code: '', is_combo: false, is_available: true }],
        }));
    });
    it('renders the login form without throwing during component render', () => {
        const markup = renderToStaticMarkup(<Login />);
        expect(markup).toContain('login-email-input');
    });

    it('keeps the salon link available in the mobile header and names the cart button', () => {
        const markup = renderToStaticMarkup(<PublicLayout />);
        expect(markup).toContain('Salón');
        expect(markup).toMatch(/<a href="\/login" class="(?![^"]*hidden)[^"]*">Salón<\/a>/);
        expect(markup).toMatch(/<button[^>]*aria-label="[^"]+"[^>]*data-testid="public-cart-button"|<button[^>]*data-testid="public-cart-button"[^>]*aria-label="[^"]+"/);
    });

    it('finds accented product names when the search query omits accents', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => { root.render(<Landing />); });
        const input = host.querySelector('[data-testid="landing-search"]');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'chicharron');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(host.textContent).toContain('Chicharrón');
        await act(async () => root.unmount());
    });

    it('explains empty search results and offers a clear-search action', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => { root.render(<Landing />); });
        const input = host.querySelector('[data-testid="landing-search"]');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'inexistente');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(host.textContent).toMatch(/sin resultados|no encontramos/i);
        const clearButton = host.querySelector('[data-testid="landing-clear-search"]');
        expect(clearButton).not.toBeNull();
        await act(async () => clearButton.click());
        expect(host.textContent).toContain('Chicharrón');
        await act(async () => root.unmount());
    });
});
