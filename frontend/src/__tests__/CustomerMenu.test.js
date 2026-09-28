import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductCard } from '@/components/ProductCard';
import { PublicLayout } from '@/components/PublicLayout';

jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    Outlet: () => null,
    useLocation: () => ({ pathname: '/menu' }),
}));
jest.mock('@/contexts/CartContext', () => ({
    useCart: () => ({ items: [], count: 2, subtotal: 48, addProduct: jest.fn(), updateQty: jest.fn() }),
}));
jest.mock('@/contexts/LiveOrderContext', () => ({
    useLiveOrder: () => ({ isActive: false, mode: 'live', order: null, productQty: jest.fn(() => 0), statusCounts: jest.fn(() => ({})), addProduct: jest.fn(), decrementProduct: jest.fn(), busy: {} }),
}));
jest.mock('@/hooks/usePolling', () => () => ({ data: { name: 'Sabor Peruano' } }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/components/CartPanel', () => ({ CartPanel: () => <div>Cart</div> }));

describe('customer menu presentation', () => {
    it('uses a compact horizontal product row with a clear add action', () => {
        const markup = renderToStaticMarkup(
            <ProductCard product={{ id: 'causa', name: 'Causa limeña', description: 'Papa amarilla y palta', price: 24, image_url: '/causa.jpg' }} />
        );

        expect(markup).toContain('Causa limeña');
        expect(markup).toContain('Papa amarilla y palta');
        expect(markup).toContain('flex-row');
        expect(markup).toContain('Agregar');
    });

    it('keeps the cart entry fixed at the bottom on public menu routes', () => {
        const markup = renderToStaticMarkup(
            <PublicLayout />
        );

        expect(markup).toContain('data-testid="public-cart-dock"');
        expect(markup).toContain('fixed bottom-0');
        expect(markup).toContain('Ver tu pedido');
    });
});
