/**
 * El enlace `/caja?order=<id>`: quien lo consume.
 *
 * `PedidoDetalle` ya navegaba ahí cuando no hay turno de caja abierto
 * (`PedidoDetalleCollection.test.js` fija esa mitad del contrato), pero **nadie
 * probaba la otra mitad**: que la caja abra el cobro de esa cuenta una sola vez.
 *
 * Importa porque el salón usa este enlace para su botón "Cobrar", y el piso
 * cambia solo cada pocos segundos: si el enlace se releyera en cada sondeo, el
 * diálogo de cobro volvería a abrirse solo después de cerrarlo.
 *
 * Las implementaciones de los mocks se fijan en `beforeEach` porque CRA corre
 * con `resetMocks: true`: lo que se pase a `jest.fn(...)` dentro de una fábrica
 * de `jest.mock` queda borrado antes de cada caso.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Caja from '@/pages/Caja';
import { api } from '@/lib/api';
import * as paymentsApi from '@/lib/api/payments';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockUser = { id: 'cashier-1', role: 'cajero', functions: ['cobro'] };
const targetOrder = {
    id: 'order-1', order_number: 17, status: 'pendiente_pago', payment_requested: true,
    order_type: 'local', subtotal: 25, total: 25, amount_paid: 0, updated_at: 'stamp', items: [],
};
const otherOrder = {
    id: 'order-2', order_number: 18, status: 'en_preparacion', order_type: 'local',
    subtotal: 10, total: 10, amount_paid: 0, updated_at: 'stamp', items: [],
};
const mockRegister = { id: 'register-1', status: 'open', opened_by_name: 'Ada', opened_at: '2026-10-01', opening_amount: 100 };

// El sondeo entrega un array NUEVO en cuanto algo del piso cambia: es lo que
// hace que un efecto que dependa de la lista vuelva a correr.
let mockOrders = [targetOrder];

jest.mock('@/lib/api', () => ({
    api: { get: jest.fn(), post: jest.fn() },
}));
// Todo el módulo de pagos se sustituye por dobles: la cola de prepagos y el
// diálogo de cobro piden lo suyo apenas montan, y cualquier lectura sin doble
// revienta la pantalla antes de poder medir nada.
jest.mock('@/lib/api/payments', () => {
    const actual = jest.requireActual('@/lib/api/payments');
    const doubles = { __esModule: true };
    for (const key of Object.keys(actual)) doubles[key] = jest.fn();
    return doubles;
});
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const source = fetcher.toString();
        if (source.includes('/cash/current')) return { data: mockRegister, refetch: jest.fn() };
        if (source.includes('/orders')) return { data: mockOrders, refetch: jest.fn() };
        return { data: [], refetch: jest.fn() };
    },
}));
// El parámetro vive fuera del componente, como en el navegador: consumirlo
// cambia lo que devuelve el hook en el siguiente render.
var mockParams = new URLSearchParams('order=order-1');
var mockSetParams = jest.fn((next) => { mockParams = next; });

jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useSearchParams: () => [mockParams, mockSetParams],
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const dialog = () => document.body.querySelector('[data-testid="caja-cobrar-dialog"]');

async function render() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Caja />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return { host, root };
}

/** Cierra el diálogo como lo haría el mozo, sin cobrar. */
async function dismiss() {
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
}

describe('/caja?order=<id>', () => {
    beforeEach(() => {
        mockOrders = [targetOrder];
        mockParams = new URLSearchParams('order=order-1');
        mockSetParams.mockReset();
        // `resetMocks` de CRA borra la implementación de fábrica: se vuelve a
        // poner acá, o el setter no cambia la URL y el enlace nunca se consume.
        mockSetParams.mockImplementation((next) => { mockParams = next; });
        api.get.mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockImplementation(() => Promise.resolve({ data: {} }));
        Object.values(paymentsApi).forEach((fn) => {
            if (jest.isMockFunction(fn)) fn.mockResolvedValue({ data: [] });
        });
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('abre el cobro de la cuenta que nombra la URL', async () => {
        const { root } = await render();
        expect(dialog()).not.toBeNull();
        expect(dialog().textContent).toContain('17');
        // El enlace se gasta al usarlo: la barra de dirección dice lo que hay en
        // pantalla, y recargar no vuelve a abrir el cobro por sorpresa.
        expect(mockSetParams).toHaveBeenCalled();
        expect(mockParams.get('order')).toBeNull();
        await act(async () => root.unmount());
    });

    it('no vuelve a abrirse solo cuando el mozo lo cierra y el piso sigue cambiando', async () => {
        const { root } = await render();
        expect(dialog()).not.toBeNull();

        await dismiss();
        expect(dialog()).toBeNull();

        // Otro pedido del salón avanza: el sondeo entrega una lista nueva.
        mockOrders = [targetOrder, otherOrder];
        await act(async () => { root.render(<Caja />); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        // El enlace ya se consumió: cerrar el cobro es una decisión del mozo.
        expect(dialog()).toBeNull();
        await act(async () => root.unmount());
    });
});
