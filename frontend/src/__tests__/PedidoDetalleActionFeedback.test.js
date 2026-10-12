import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PedidoDetalle from '@/pages/PedidoDetalle';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

// `var`/`mock*` names: jest.mock factories are hoisted above constants.
var mockOrder;
const mockUser = { id: 'u1', role: 'admin', functions: ['administracion', 'atencion', 'cobro'], restaurant_id: 'r1' };
const mockNavigate = jest.fn();
const mockRefetch = jest.fn();

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('@/hooks/useBranchNames', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/hooks/useRestaurantFeatures', () => ({ __esModule: true, default: () => ({ item_void: true }) }));
jest.mock('@/components/CobrarDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (String(fetcher).includes('getOrder')
        ? { data: mockOrder, refetch: mockRefetch }
        : { data: [], refetch: jest.fn() }),
}));
jest.mock('react-router-dom', () => ({ useParams: () => ({ id: 'order-1' }), useNavigate: () => mockNavigate }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const baseOrder = {
    id: 'order-1', order_number: 17, status: 'nuevo', payment_status: 'pendiente', acceptance_status: 'aceptado',
    order_type: 'local', subtotal: 25, total: 25, amount_paid: 0,
    items: [{ id: 'item-1', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, status: 'pendiente' }],
};

let host; let root; let resolve;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const tap = (el, times = 1) => act(async () => { for (let i = 0; i < times; i += 1) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const calls = (method, re) => api[method].mock.calls.filter(([url]) => re.test(url));

async function mount(order) {
    mockOrder = { ...baseOrder, ...order };
    api.get.mockReset().mockImplementation(() => new Promise((r) => { resolve = r; }));
    api.post.mockReset().mockImplementation(() => new Promise((r) => { resolve = r; }));
    api.delete.mockReset().mockImplementation(() => new Promise((r) => { resolve = r; }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<PedidoDetalle />));
}

afterEach(async () => {
    await act(async () => { resolve?.({ data: {} }); await Promise.resolve(); });
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
});

describe('order detail actions show they are working', () => {
    test('send to kitchen sends once and says Enviando…', async () => {
        await mount({ status: 'nuevo' });
        await tap(q('pedido-enviar-cocina-detalle'), 3);
        expect(calls('post', /send-to-kitchen/)).toHaveLength(1);
        expect(q('pedido-enviar-cocina-detalle').textContent).toBe('Enviando…');
        expect(q('pedido-enviar-cocina-detalle').disabled).toBe(true);
        expect(q('pedido-enviar-cocina-detalle').getAttribute('aria-busy')).toBe('true');
    });

    test('serve sends once and says Entregando…', async () => {
        await mount({ status: 'listo' });
        await tap(q('pedido-servir-button'), 3);
        expect(calls('post', /\/serve$/)).toHaveLength(1);
        expect(q('pedido-servir-button').textContent).toBe('Entregando…');
        expect(q('pedido-servir-button').disabled).toBe(true);
    });

    test('request bill sends once and says Solicitando…', async () => {
        await mount({ status: 'entregado' });
        await tap(q('pedido-solicitar-cuenta-button'), 3);
        expect(calls('post', /\/status$/)).toHaveLength(1);
        expect(q('pedido-solicitar-cuenta-button').textContent).toBe('Solicitando…');
    });

    test('removing an item sends once', async () => {
        await mount({ status: 'nuevo' });
        const btn = () => q('pedido-item-cancel-item-1');
        await tap(btn(), 3);
        expect([...calls('delete', /items\/item-1$/), ...calls('post', /items\/item-1\/void$/)]).toHaveLength(1);
        expect(btn().disabled).toBe(true);
    });

    test('Cobrar fetches the cash register once and says Abriendo cobro…', async () => {
        await mount({ status: 'entregado' });
        await tap(q('pedido-cobrar-button'), 3);
        expect(calls('get', /cash\/current/)).toHaveLength(1);
        expect(q('pedido-cobrar-button').textContent).toContain('Abriendo cobro…');
        expect(q('pedido-cobrar-button').disabled).toBe(true);
    });

    test('confirming the cancellation sends once and says Anulando…', async () => {
        await mount({ status: 'nuevo' });
        await tap(q('pedido-cancelar-button'));
        const reason = document.body.querySelector('[data-testid="cancel-reason-input"]');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(reason, 'Error del cliente');
            reason.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const confirm = () => document.body.querySelector('[data-testid="cancel-confirm-button"]');
        await tap(confirm(), 3);
        expect(calls('post', /\/status$/)).toHaveLength(1);
        expect(confirm().textContent).toBe('Anulando…');
        expect(confirm().disabled).toBe(true);
    });
});
