import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import Cocina from '../pages/Cocina';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockOrders = [
    {
        id: 'order-22', order_number: 22, order_type: 'mesa', table_id: 'table-5',
        status: 'en_preparacion', created_at: '2026-09-28T10:00:00Z',
        items: [
            { id: 'item-new', status: 'pendiente', quantity: 1, product_name: 'Causa', added_at: '2026-09-28T10:10:00Z', notes: 'Sin mayonesa' },
            { id: 'item-fire', status: 'en_preparacion', quantity: 1, product_name: 'Lomo', added_at: '2026-09-28T10:05:00Z' },
            { id: 'item-ready', status: 'listo', quantity: 2, product_name: 'Ají', added_at: '2026-09-28T10:02:00Z' },
        ],
    },
    {
        id: 'order-23', order_number: 23, order_type: 'mesa', table_id: 'table-5',
        status: 'pendiente', created_at: '2026-09-28T10:00:00Z',
        items: [
            { id: 'item-old-potatoes', status: 'pendiente', quantity: 1, product_name: 'Papas doradas', added_at: '2026-09-28T10:02:00Z' },
            { id: 'item-old-salad', status: 'pendiente', quantity: 1, product_name: 'Ensalada', added_at: '2026-09-28T10:03:00Z' },
            { id: 'item-old-fire', status: 'en_preparacion', quantity: 1, product_name: 'Arroz con pollo', added_at: '2026-09-28T10:04:00Z' },
        ],
    },
    {
        id: 'order-21', order_number: 21, order_type: 'recojo', status: 'entregado',
        updated_at: '2026-09-28T10:15:00Z', created_at: '2026-09-28T09:55:00Z',
        items: [{ id: 'item-served', status: 'entregado', quantity: 1, product_name: 'Sopa' }],
    },
];

jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: (fetcher) => ({ data: fetcher.toString().includes('/tables') ? [{ id: 'table-5', name: 'Mesa 05', area: 'Salón' }] : mockOrders, refetch: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'cocina' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a> }));

describe('Cocina priority board', () => {
    it('orders multiple incoming tickets oldest first while preserving mixed item stages and accessible priorities', () => {
        const markup = renderToStaticMarkup(<Cocina />);
        expect(markup).toContain('role="tablist"');
        expect(markup).toContain('aria-label="Tandas por estado"');
        expect(markup).toContain('md:hidden');
        expect(markup).toContain('md:grid-cols-2');
        expect(markup).toContain('md:block');
        expect(markup).toContain('aria-selected="true"');
        expect(markup).toContain('data-testid="cocina-columna-llegan"');
        expect(markup).toContain('data-testid="cocina-columna-fuego"');
        expect(markup).toContain('data-testid="cocina-columna-listo"');
        expect(markup).toContain('data-testid="cocina-columna-retirado"');
        expect(markup).toContain('data-testid="cocina-ticket-23-llegan"');
        expect(markup).toContain('Papas doradas');
        expect(markup).toContain('Ensalada');
        expect(markup).toContain('Causa');
        const oldestIncoming = markup.indexOf('data-testid="cocina-ticket-23-llegan"');
        const newerIncoming = markup.indexOf('data-testid="cocina-ticket-22-llegan"');
        expect(oldestIncoming).toBeGreaterThan(-1);
        expect(newerIncoming).toBeGreaterThan(-1);
        expect(oldestIncoming).toBeLessThan(newerIncoming);
        expect(markup).toContain('data-testid="cocina-ticket-23-fuego"');
        expect(markup).toContain('Arroz con pollo');
        const olderFire = markup.indexOf('data-testid="cocina-ticket-23-fuego"');
        const newerFire = markup.indexOf('data-testid="cocina-ticket-22-fuego"');
        expect(olderFire).toBeLessThan(newerFire);
        expect(markup).toContain('Más antiguas primero');
        expect(markup).toContain('data-testid="cocina-ticket-22-fuego"');
        expect(markup).toContain('data-testid="cocina-ticket-22-listo"');
        expect(markup).toContain('data-testid="cocina-ticket-21-retirado"');
        expect(markup).toContain('· AGREGADO');
        expect(markup).toContain('Sin mayonesa');
        expect(markup).toContain('aria-label="Marcar Lomo listo"');
        expect(markup).toContain('hace ');
    });

    it('switches the mobile priority panel by keyboard arrow', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => root.render(<Cocina />));

        const lleganTab = container.querySelector('#cocina-tab-llegan');
        await act(async () => {
            lleganTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });

        expect(container.querySelector('#cocina-tab-fuego').getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('#cocina-panel-fuego').classList.contains('hidden')).toBe(false);
        expect(container.querySelector('#cocina-panel-llegan').classList.contains('hidden')).toBe(true);
        await act(async () => root.unmount());
        container.remove();
    });

    it('runs the existing order and per-item kitchen transitions from explicit controls', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        api.post.mockClear();
        await act(async () => root.render(<Cocina />));

        await act(async () => {
            container.querySelector('[data-testid="cocina-ticket-22-llegan"] button:last-child').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(api.post).toHaveBeenNthCalledWith(1, '/orders/order-22/bump', { from_status: 'pendiente' });

        await act(async () => {
            container.querySelector('#cocina-tab-fuego').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await act(async () => {
            container.querySelector('[aria-label="Marcar Lomo listo"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(api.post).toHaveBeenNthCalledWith(2, '/orders/order-22/items/item-fire/status', { status: 'listo' });

        await act(async () => root.unmount());
        container.remove();
    });
});
