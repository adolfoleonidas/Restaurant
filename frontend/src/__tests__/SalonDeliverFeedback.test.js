/**
 * Lo que ve el mozo al pulsar «Entregar» en la tarjeta de una mesa.
 *
 * Reportado: «el número de monto cambia por un momento y luego se muestra la
 * original» y «el botón se demora en cambiar el estado o no cambia; recién cambia
 * cuando abro el pedido».
 *
 * Las dos cosas venían del parche optimista: `patchOrder` usaba la función como
 * objeto **completo** en vez de fusionarla, así que el pedido quedaba reducido a
 * `{ items }` y la tarjeta perdía `status` y `total`. Y el parche solo movía los
 * platos, no el estado, así que la mesa seguía diciendo «Listo» hasta el sondeo.
 *
 * Este archivo monta la pantalla con el `usePolling` **real** (con su `patch`)
 * para que el parche llegue de verdad a la tarjeta, que es donde se vio el fallo.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

// El sondeo devuelve esto hasta que alguien lo cambie: `var` para que la fábrica
// elevada de `jest.mock` pueda verlas.
var mockTables = [];
var mockOrders = [];

const servedOrder = () => ({
    id: 'order-4', order_number: 21, table_id: 'table-4', attention_id: 'visit-4',
    attention_state: 'open', status: 'listo', payment_status: 'pendiente',
    order_type: 'mesa', total: 45, subtotal: 45, amount_paid: 0,
    fulfillment_status: 'listo', created_at: '2026-01-01T12:00:00Z',
    items: [{ id: 'i1', product_name: 'Lomo', quantity: 1, subtotal: 45, status: 'listo' }],
});

const readyTable = () => ({
    id: 'table-4', number: 4, name: 'Mesa 4', area: 'Salón', capacity: 4, status: 'ocupada',
    branch_id: 'branch-1', active_attention_id: 'visit-4', qr_status: 'active',
    group: null, group_id: null,
    active_order: { id: 'order-4', status: 'listo', total: 45, amount_paid: 0, payment_status: 'pendiente' },
});

// `usePolling` de verdad, pero alimentado por las variables de arriba: el `patch`
// es el real, y es lo que se está probando.
jest.mock('@/hooks/usePolling', () => {
    const React = require('react');
    const slotFor = (fetcher) => {
        const source = String(fetcher);
        if (source.includes('legacy_only')) return null;          // mesas sin sucursal
        if (source.includes('listTables') || source.includes('scopedGet')) {
            return source.includes('listTables') ? 'tables' : null;
        }
        if (source.includes('listOrders')) return 'orders';
        return null;
    };
    return {
        __esModule: true,
        default: (fetcher) => {
            const slot = slotFor(fetcher);
            const [data, setData] = React.useState(() => (
                slot === 'tables' ? mockTables : slot === 'orders' ? mockOrders : null
            ));
            const patch = React.useCallback(
                (updater) => setData((current) => (current == null ? current : updater(current))),
                [],
            );
            return { data, error: null, loading: false, refetch: jest.fn(), patch };
        },
    };
});
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }),
}));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [new URLSearchParams()],
    useLocation: () => ({ pathname: '/salon' }),
    useParams: () => ({}),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const card = (container) => container.querySelector('[data-testid="mesa-card-4"]');

async function renderFloor() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Salon />); await Promise.resolve(); });
    return { container, root };
}

describe('entregar desde la tarjeta del piso', () => {
    beforeEach(() => {
        mockTables = [readyTable()];
        mockOrders = [servedOrder()];
        api.get.mockImplementation(() => Promise.resolve({ data: [] }));
        // El POST queda en vuelo: así se mira lo que la tarjeta pinta **al toque**,
        // antes de que el servidor conteste.
        api.post.mockImplementation(() => new Promise(() => {}));
        api.patch.mockImplementation(() => Promise.resolve({ data: {} }));
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('cambia a «Entregado» al toque, sin perder el monto ni ofrecer «Tomar pedido»', async () => {
        const { container, root } = await renderFloor();
        expect(card(container).getAttribute('data-floor-state')).toBe('listo');
        const amountBefore = card(container).textContent;
        expect(amountBefore).toContain('45.00');

        const deliver = container.querySelector('[data-testid="mesa-card-deliver-4"]');
        expect(deliver).not.toBeNull();
        await act(async () => {
            deliver.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        // El estado se mueve ya, no dentro de 8 s.
        expect(card(container).getAttribute('data-floor-state')).toBe('entregado');
        // El monto no parpadea: sigue siendo el mismo.
        expect(card(container).textContent).toContain('45.00');
        // Y la tarjeta no cae al estado de una mesa libre: ese «Tomar pedido» era
        // el síntoma de perder `status` y `total` en el parche.
        expect(container.querySelector('[data-testid="mesa-card-pedir-4"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-deliver-4"]')).toBeNull();
        // El paso siguiente ya está a la vista.
        expect(container.querySelector('[data-testid="mesa-card-cuenta-4"]')).not.toBeNull();

        await act(async () => root.unmount());
    });

    it('una cuenta ya cobrada pasa a «Cuenta pagada» con su botón de finalizar', async () => {
        mockOrders = [{ ...servedOrder(), amount_paid: 45, payment_status: 'pagado' }];
        mockTables = [{
            ...readyTable(),
            active_order: { id: 'order-4', status: 'listo', total: 45, amount_paid: 45, payment_status: 'pagado' },
        }];
        const { container, root } = await renderFloor();

        await act(async () => {
            container.querySelector('[data-testid="mesa-card-deliver-4"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(card(container).getAttribute('data-floor-state')).toBe('pagada');
        expect(container.querySelector('[data-testid="servicio-cerrar-4"]')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
