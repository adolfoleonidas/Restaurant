/**
 * «Solicitar cuenta» en el piso, y el cierre de una visita con varias cuentas.
 *
 * Dos huecos que se veían desde la pantalla:
 *
 *  1. En «Entregado» —el paso siguiente a servir— la tarjeta se quedaba **sin
 *     ningún botón**: pedir la cuenta solo existía dentro de la hoja, así que el
 *     mozo tenía que abrir mesa por mesa. Ahora la tarjeta lo ofrece con la misma
 *     regla que la hoja (`canRequestBill`).
 *  2. «Finalizar mesa» solo miraba la cuenta activa, pero el servidor exige que
 *     **todas** las de la visita estén liquidadas (`attention.py:444-451`): el
 *     botón se ofrecía y el cierre fallaba con «La cuenta #N no está lista».
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

var mockOrders = [];

const delivered = (extra = {}) => ({
    id: 'order-4', order_number: 21, table_id: 'table-4', attention_id: 'visit-4',
    attention_state: 'open', status: 'entregado', payment_status: 'pendiente',
    order_type: 'mesa', total: 45, subtotal: 45, amount_paid: 0, item_count: 1,
    created_at: new Date().toISOString(),
    items: [{ id: 'i1', product_name: 'Lomo', quantity: 1, subtotal: 45, status: 'entregado' }],
    ...extra,
});

const table = (extra = {}) => ({
    id: 'table-4', number: 4, name: 'Mesa 4', area: 'Salón', capacity: 4, status: 'ocupada',
    branch_id: 'branch-1', active_attention_id: 'visit-4', qr_status: 'active',
    group: null, group_id: null, active_order: { id: 'order-4', status: 'entregado', total: 45 },
    ...extra,
});

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }),
}));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const source = String(fetcher);
        if (source.includes('listTables')) return { data: [table()], refetch: jest.fn() };
        if (source.includes('listOrders')) return { data: mockOrders, refetch: jest.fn() };
        return { data: [], refetch: jest.fn() };
    },
}));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [new URLSearchParams()],
    useLocation: () => ({ pathname: '/salon' }),
    useParams: () => ({}),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

async function renderFloor() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Salon />); await Promise.resolve(); await Promise.resolve(); });
    return { container, root };
}

const click = async (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('pedir la cuenta desde el piso', () => {
    beforeEach(() => {
        mockOrders = [delivered()];
        api.get.mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockImplementation(() => Promise.resolve({ data: {} }));
        api.patch.mockImplementation(() => Promise.resolve({ data: {} }));
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('ofrece «Solicitar cuenta» en «Entregado» y la manda a la API', async () => {
        const { container, root } = await renderFloor();
        expect(container.querySelector('[data-testid="mesa-card-4"]').getAttribute('data-floor-state')).toBe('entregado');

        const bill = container.querySelector('[data-testid="mesa-card-cuenta-4"]');
        expect(bill).not.toBeNull();
        expect(bill.textContent).toContain('Solicitar cuenta');
        // Todavía no se puede finalizar: no hay pago.
        expect(container.querySelector('[data-testid="servicio-cerrar-4"]')).toBeNull();

        await click(bill);
        expect(api.post).toHaveBeenCalledWith('/orders/order-4/status', { status: 'pendiente_pago' });
        await act(async () => root.unmount());
    });

    it('no la vuelve a ofrecer cuando ya se pidió', async () => {
        mockOrders = [delivered({ payment_requested: true })];
        const { container, root } = await renderFloor();
        expect(container.querySelector('[data-testid="mesa-card-cuenta-4"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('no la ofrece mientras la comida sigue en cocina', async () => {
        mockOrders = [delivered({
            status: 'en_preparacion',
            items: [{ id: 'i1', product_name: 'Lomo', quantity: 1, subtotal: 45, status: 'en_preparacion' }],
        })];
        const { container, root } = await renderFloor();
        expect(container.querySelector('[data-testid="mesa-card-cuenta-4"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-cobrar-4"]')).toBeNull();
        await act(async () => root.unmount());
    });
});

describe('finalizar una visita con dos cuentas', () => {
    beforeEach(() => {
        // La cuenta activa está cobrada y entregada; la hermana todavía no pagó.
        mockOrders = [
            delivered({ id: 'order-4', status: 'pagado', payment_status: 'pagado', amount_paid: 45 }),
            delivered({
                id: 'order-9', order_number: 22, status: 'entregado', payment_status: 'pendiente',
                total: 18, subtotal: 18, amount_paid: 0,
                items: [{ id: 'i2', product_name: 'Sopa', quantity: 1, subtotal: 18, status: 'entregado' }],
            }),
        ];
        api.get.mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockImplementation(() => Promise.resolve({ data: {} }));
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('tampoco la ofrece en la tarjeta mientras la cuenta hermana no esté lista', async () => {
        const { container, root } = await renderFloor();
        const card = container.querySelector('[data-testid="mesa-card-4"]');
        expect(card).not.toBeNull();
        // La tarjeta toma la cuenta **viva** de la visita (`activeAttentionOrder`
        // descarta las ya cobradas), así que aquí mira la hermana sin pagar y no
        // ofrece cerrar. El caso en que la divergencia sí se veía —mirando una
        // cuenta cobrada mientras otra no lo está— es la hoja, y ahí lo fija
        // `salonSelectors.test.js`.
        expect(card.getAttribute('data-floor-state')).toBe('entregado');
        expect(container.querySelector('[data-testid="servicio-cerrar-4"]')).toBeNull();
        await act(async () => root.unmount());
    });
});
