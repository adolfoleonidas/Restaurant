import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import Cocina from '../pages/Cocina';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockOrders = [
    {
        id: 'order-22', order_number: 22, order_type: 'mesa', table_id: 'table-5', acceptance_status: 'aceptado', attention_number: 7, attention_business_date: '2026-10-02', branch_id: 'branch-a',
        status: 'en_preparacion', created_at: '2026-09-28T10:00:00Z',
        items: [
            { id: 'item-new', status: 'pendiente', quantity: 1, product_name: 'Causa', added_at: '2026-09-28T10:10:00Z', notes: 'Sin mayonesa' },
            { id: 'item-fire', status: 'en_preparacion', quantity: 1, product_name: 'Lomo', added_at: '2026-09-28T10:05:00Z' },
            { id: 'item-ready', status: 'listo', quantity: 2, product_name: 'Ají', added_at: '2026-09-28T10:02:00Z' },
        ],
    },
    {
        id: 'order-23', order_number: 23, order_type: 'mesa', table_id: 'table-5', acceptance_status: 'aceptado', attention_number: 7, attention_business_date: '2026-10-03', branch_id: 'branch-b',
        status: 'pendiente', created_at: '2026-09-28T10:00:00Z',
        items: [
            { id: 'item-old-potatoes', status: 'pendiente', quantity: 1, product_name: 'Papas doradas', added_at: '2026-09-28T10:12:00Z' },
            { id: 'item-old-salad', status: 'pendiente', quantity: 1, product_name: 'Ensalada', added_at: '2026-09-28T10:02:00Z' },
            { id: 'item-old-fire', status: 'en_preparacion', quantity: 1, product_name: 'Arroz con pollo', added_at: '2026-09-28T10:04:00Z' },
        ],
    },
    {
        id: 'order-21', order_number: 21, order_type: 'recojo', status: 'entregado',
        updated_at: '2026-09-28T10:15:00Z', created_at: '2026-09-28T09:55:00Z',
        items: [{ id: 'item-served', status: 'entregado', quantity: 1, product_name: 'Sopa' }],
    },
];

jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: (fetcher) => ({ data: fetcher.toString().includes('listTables') ? [{ id: 'table-5', name: 'Mesa 05', area: 'Salón' }] : mockOrders, refetch: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'cocina' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a> }));

describe('Cocina priority board', () => {
    it('keeps unfinished pickups in the live pass and exposes stale ready pickups in a closed history section', () => {
        mockOrders.push(
            {
                id: 'pickup-ready-old', order_number: 31, order_type: 'recojo', status: 'listo',
                ready_at: '2000-01-01T10:00:00Z', items: [{ id: 'ready-old', status: 'listo', product_name: 'Empanadas', quantity: 1 }],
            },
            {
                id: 'pickup-working-old', order_number: 32, order_type: 'recojo', status: 'en_preparacion',
                created_at: '2000-01-01T09:00:00Z', items: [{ id: 'working-old', status: 'en_preparacion', product_name: 'Tamal', quantity: 1 }],
            }
        );
        try {
            const markup = renderToStaticMarkup(<Cocina />);
            expect(markup).toContain('<details class="rounded-md border border-border bg-card/50 p-3" data-testid="cocina-dias-anteriores">');
            expect(markup).toContain('cocina-recojo-anterior-pickup-ready-old');
            expect(markup).toContain('href="/pedidos/pickup-ready-old"');
            expect(markup).not.toContain('cocina-recojo-anterior-pickup-working-old');
            expect(markup).toContain('data-testid="cocina-ticket-32-fuego"');
        } finally {
            mockOrders.splice(-2, 2);
        }
    });

    it('orders multiple incoming tickets oldest first while preserving mixed item stages and accessible priorities', () => {
        const markup = renderToStaticMarkup(<Cocina />);
        expect(markup).toContain('data-testid="cocina-kanban"');
        expect(markup).toContain('overflow-x-auto');
        expect(markup).toContain('snap-x snap-mandatory');
        expect(markup).toContain('w-[90%]');
        expect(markup).toContain('snap-start');
        expect(markup).toContain('md:grid-cols-2');
        expect(markup).toContain('md:overflow-visible');
        expect(markup).toContain('md:w-auto');
        expect(markup).toContain('md:snap-none');
        expect(markup).not.toContain('role="tablist"');
        expect(markup).not.toContain('role="tab"');
        expect(markup).not.toContain('role="tabpanel"');
        expect(markup).not.toContain('aria-selected=');
        expect(markup).not.toContain('class="hidden');
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
        expect(markup).toContain('Atención 7');
        expect(markup).toContain('2026-10-02');
        expect(markup).toContain('branch-a');
        expect(markup).toContain('2026-10-03');
        expect(markup).toContain('branch-b');
    });

    it('keeps every task lane mounted and readable in one swipeable mobile board', () => {
        const markup = renderToStaticMarkup(<Cocina />);
        for (const lane of ['llegan', 'fuego', 'listo', 'retirado']) {
            expect(markup).toContain(`data-testid="cocina-columna-${lane}"`);
        }
        expect(markup.match(/data-testid="cocina-columna-/g)).toHaveLength(4);
        expect(markup.match(/data-testid="cocina-ticket-22-/g)).toHaveLength(3);
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
            container.querySelector('[aria-label="Marcar Lomo listo"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(api.post).toHaveBeenNthCalledWith(2, '/orders/order-22/items/item-fire/status', { status: 'listo' });

        await act(async () => root.unmount());
        container.remove();
    });

    it('pinta en rojo los minutos desde los 15 y mantiene el aviso intermedio de los 10', async () => {
        const minutesAgo = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
        mockOrders.push(
            {
                id: 'order-late', order_number: 40, order_type: 'mesa', table_id: 'table-5', status: 'pendiente',
                items: [{ id: 'late-item', status: 'en_preparacion', quantity: 1, product_name: 'Guiso', added_at: minutesAgo(20) }],
            },
            {
                id: 'order-warn', order_number: 41, order_type: 'mesa', table_id: 'table-5', status: 'pendiente',
                items: [{ id: 'warn-item', status: 'en_preparacion', quantity: 1, product_name: 'Milanesa', added_at: minutesAgo(12) }],
            },
            {
                id: 'order-fresh', order_number: 42, order_type: 'mesa', table_id: 'table-5', status: 'pendiente',
                items: [{ id: 'fresh-item', status: 'en_preparacion', quantity: 1, product_name: 'Ensalada', added_at: minutesAgo(3) }],
            }
        );
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => root.render(<Cocina />));
            const timerOf = (number) => container.querySelector(`[data-testid="cocina-ticket-${number}-fuego"] .font-mono`);
            expect(timerOf(40).className).toContain('text-destructive');
            expect(timerOf(41).className).toContain('text-primary');
            expect(timerOf(42).className).toContain('text-muted-foreground');
        } finally {
            await act(async () => root.unmount());
            container.remove();
            mockOrders.splice(-3, 3);
            document.body.innerHTML = '';
        }
    });

    it('etiqueta el origen del ticket: Mozo para staff y carta web para web/QR', async () => {
        mockOrders.push({
            id: 'order-web', order_number: 24, order_type: 'mesa', table_id: 'table-5', source: 'public', status: 'pendiente',
            items: [{ id: 'web-item', status: 'pendiente', quantity: 1, product_name: 'Tacos', added_at: '2026-09-28T10:10:00Z' }],
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => root.render(<Cocina />));
            // Los pedidos de staff (sin `source` público) salen como "👤 Mozo".
            const staffTicket = container.querySelector('[data-testid="cocina-ticket-22-fuego"]');
            expect(staffTicket.textContent).toContain('👤 Mozo');
            expect(staffTicket.textContent).not.toContain('carta web');
            // Los pedidos web/QR conservan "carta web".
            const webTicket = container.querySelector('[data-testid="cocina-ticket-24-llegan"]');
            expect(webTicket.textContent).toContain('carta web');
            expect(webTicket.textContent).not.toContain('Mozo');
        } finally {
            await act(async () => root.unmount());
            container.remove();
            mockOrders.splice(-1, 1);
            document.body.innerHTML = '';
        }
    });
});
