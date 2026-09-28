import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import Cocina from '../pages/Cocina';

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
    it('keeps each item wave and exposes accessible stage priorities', () => {
        const markup = renderToStaticMarkup(<Cocina />);
        expect(markup).toContain('role="tablist"');
        expect(markup).toContain('aria-label="Tandas por estado"');
        expect(markup).toContain('aria-selected="true"');
        expect(markup).toContain('data-testid="cocina-columna-llegan"');
        expect(markup).toContain('data-testid="cocina-columna-fuego"');
        expect(markup).toContain('data-testid="cocina-columna-listo"');
        expect(markup).toContain('data-testid="cocina-columna-retirado"');
        expect(markup).toContain('data-testid="cocina-ticket-22-llegan"');
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
});





