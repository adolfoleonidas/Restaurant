/**
 * TR-02: each screen refetches only for the realtime topics it renders.
 *
 * The screens run for real (real NotifyProvider, real usePolling) against a
 * hand-fed event stream; only the HTTP layer is a spy. A waiter's composer tap
 * publishes an `orders`-only event (a draft line the kitchen never sees), so it
 * must not wake the kitchen, the cash register or the catalog.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { NotifyProvider } from '@/contexts/NotifyContext';
import { api } from '@/lib/api';
import { KitchenAlerts } from '@/components/KitchenAlerts';
import { RoleInbox } from '@/components/RoleInbox';
import useSalonData from '@/pages/salon/useSalonData';
import PedidoDetalle from '@/pages/PedidoDetalle';
import Cocina from '@/pages/Cocina';
import Caja from '@/pages/Caja';

global.IS_REACT_ACT_ENVIRONMENT = true;
global.TextDecoder = global.TextDecoder || NodeTextDecoder;
const encoder = new NodeTextEncoder();

// `mock*` names: jest.mock factories are hoisted above constants.
const ADMIN = { id: 'u1', role: 'admin', functions: ['administracion', 'atencion', 'cobro'], restaurant_id: 'r1' };
// The cashier lands on the branch cash register; an owner would get the consolidated view.
const CASHIER = { id: 'cashier-1', role: 'cajero', restaurant_id: 'r1' };
let mockUser = ADMIN;

jest.mock('@/lib/api', () => ({ API: '/api', api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useBranchNames', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/hooks/useRestaurantFeatures', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/components/CobrarDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to }) => <a href={to}>{children}</a>,
    useParams: () => ({ id: 'order-1' }),
    useNavigate: () => jest.fn(),
    useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));

const ORDER = {
    id: 'order-1', order_number: 17, status: 'nuevo', payment_status: 'pendiente', acceptance_status: 'aceptado',
    order_type: 'local', subtotal: 25, total: 25, amount_paid: 0,
    items: [{ id: 'item-1', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, status: 'pendiente' }],
};
const RESPONSES = {
    '/orders/order-1': ORDER,
    '/cash/current': null,
};

// A stream the test feeds by hand.
function controllableStream() {
    const waiting = [];
    const buffered = [];
    const deliver = (chunk) => {
        if (waiting.length) waiting.shift()(chunk);
        else buffered.push(chunk);
    };
    deliver({ done: false, value: encoder.encode('data: {"type":"hello"}\n\n') });
    return {
        push: (event) => deliver({ done: false, value: encoder.encode(`data: ${JSON.stringify(event)}\n\n`) }),
        response: {
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: () => {
                        if (buffered.length) return Promise.resolve(buffered.shift());
                        return new Promise((resolve) => { waiting.push(resolve); });
                    },
                }),
            },
        },
    };
}

// What the server publishes (see backend/notify.py). A staff draft-line batch
// carries `extra: draft_lines` and names the waiter who caused it.
const DRAFT_EDIT = { type: 'order', order_id: 'order-9', status: 'nuevo', topic: 'orders', topics: ['orders'], extra: 'draft_lines' };
const KITCHEN = { type: 'order', order_id: 'order-9', status: 'enviado_cocina', topic: 'orders', topics: ['orders', 'kitchen'] };
const PAYMENT = {
    type: 'order', order_id: 'order-9', status: 'pagado', payment_status: 'pagado',
    topic: 'orders', topics: ['orders', 'kitchen', 'payments'],
};
const TABLE = { type: 'table', table_id: 't1', status: 'ocupada', topic: 'tables', topics: ['tables'] };
const CASH = { type: 'cash', status: 'movement', topic: 'cash', topics: ['cash'] };
const CATALOG = { type: 'product', product_id: 'p1', topic: 'catalog', topics: ['catalog'] };
const LEGACY = { type: 'something_new' };

let root;
let host;
let stream;
const settle = async (ms = 0) => {
    await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); });
    for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    }
};
const emit = async (event) => {
    await act(async () => { stream.push(event); await Promise.resolve(); await Promise.resolve(); });
    await settle(300);
};
const gets = (url) => api.get.mock.calls.filter(([u]) => u === url).length;
const fetched = (...urls) => Object.fromEntries(urls.map((u) => [u, gets(u)]));

async function mount(element) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<NotifyProvider>{element}</NotifyProvider>); });
    await settle();
    // Count only what the events cause, not the first load.
    api.get.mockClear();
}

beforeEach(() => {
    mockUser = ADMIN;
    jest.useFakeTimers();
    localStorage.setItem('token', 'tkn');
    sessionStorage.clear();
    stream = controllableStream();
    global.fetch = jest.fn().mockResolvedValue(stream.response);
    api.get.mockReset().mockImplementation((url) => Promise.resolve({ data: url in RESPONSES ? RESPONSES[url] : [] }));
    api.post.mockReset().mockResolvedValue({ data: {} });
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    jest.useRealTimers();
    delete global.fetch;
    localStorage.clear();
});

function SalonProbe() {
    useSalonData({ isOwner: false, scope: 'all', scopeKey: 'k', scopeParams: {}, scopePending: false });
    return null;
}

describe('global alerts (every screen has them mounted)', () => {
    const alerts = (
        <>
            <KitchenAlerts />
            <RoleInbox />
        </>
    );

    it('a composer tap (draft line) refetches neither the kitchen list nor the inbox', async () => {
        await mount(alerts);
        await emit(DRAFT_EDIT);
        expect(fetched('/orders/kitchen', '/orders')).toEqual({ '/orders/kitchen': 0, '/orders': 0 });
    });

    it('an order the kitchen sees refetches both once', async () => {
        await mount(alerts);
        await emit(KITCHEN);
        expect(fetched('/orders/kitchen', '/orders')).toEqual({ '/orders/kitchen': 1, '/orders': 1 });
    });

    it('table, cash and catalog events refetch neither', async () => {
        await mount(alerts);
        await emit(TABLE);
        await emit(CASH);
        await emit(CATALOG);
        expect(fetched('/orders/kitchen', '/orders')).toEqual({ '/orders/kitchen': 0, '/orders': 0 });
    });

    it('an event without a topic refreshes both', async () => {
        await mount(alerts);
        await emit(LEGACY);
        expect(fetched('/orders/kitchen', '/orders')).toEqual({ '/orders/kitchen': 1, '/orders': 1 });
    });
});

describe('Salón data', () => {
    const urls = ['/tables', '/orders', '/products', '/categories'];

    it('a composer tap of this same waiter refetches nothing: his own write already answered with the order', async () => {
        await mount(<SalonProbe />);
        await emit({ ...DRAFT_EDIT, actor_user_id: 'u1' });
        expect(fetched(...urls)).toEqual({ '/tables': 0, '/orders': 0, '/products': 0, '/categories': 0 });
    });

    it("another waiter's draft edit still refetches the orders and the tables (which embed them), not the menu", async () => {
        await mount(<SalonProbe />);
        await emit({ ...DRAFT_EDIT, actor_user_id: 'mozo-2' });
        expect(fetched(...urls)).toEqual({ '/tables': 1, '/orders': 1, '/products': 0, '/categories': 0 });
    });

    it('a draft edit that names no actor refreshes like any other event', async () => {
        await mount(<SalonProbe />);
        await emit(DRAFT_EDIT);
        expect(fetched(...urls)).toEqual({ '/tables': 1, '/orders': 1, '/products': 0, '/categories': 0 });
    });

    it('a table event caused by this same waiter still refetches the tables: only the draft echo is skipped', async () => {
        await mount(<SalonProbe />);
        await emit({ ...TABLE, actor_user_id: 'u1' });
        expect(fetched(...urls)).toEqual({ '/tables': 1, '/orders': 0, '/products': 0, '/categories': 0 });
    });

    it('a table event refetches only the tables', async () => {
        await mount(<SalonProbe />);
        await emit(TABLE);
        expect(fetched(...urls)).toEqual({ '/tables': 1, '/orders': 0, '/products': 0, '/categories': 0 });
    });

    it('a catalog event refetches only the menu', async () => {
        await mount(<SalonProbe />);
        await emit(CATALOG);
        expect(fetched(...urls)).toEqual({ '/tables': 0, '/orders': 0, '/products': 1, '/categories': 1 });
    });

    it('a cash event refetches nothing', async () => {
        await mount(<SalonProbe />);
        await emit(CASH);
        expect(fetched(...urls)).toEqual({ '/tables': 0, '/orders': 0, '/products': 0, '/categories': 0 });
    });

    it('an event without a topic refetches everything', async () => {
        await mount(<SalonProbe />);
        await emit(LEGACY);
        expect(fetched(...urls)).toEqual({ '/tables': 1, '/orders': 1, '/products': 1, '/categories': 1 });
    });
});

describe('Cocina', () => {
    const urls = ['/orders/kitchen', '/tables'];

    it('ignores a composer tap', async () => {
        await mount(<Cocina />);
        await emit(DRAFT_EDIT);
        expect(fetched(...urls)).toEqual({ '/orders/kitchen': 0, '/tables': 0 });
    });

    it('refetches the board for a kitchen event and the tables for a table event', async () => {
        await mount(<Cocina />);
        await emit(KITCHEN);
        expect(fetched(...urls)).toEqual({ '/orders/kitchen': 1, '/tables': 0 });
        await emit(TABLE);
        expect(fetched(...urls)).toEqual({ '/orders/kitchen': 1, '/tables': 1 });
    });
});

describe('PedidoDetalle', () => {
    it('refetches its order only for events of that order', async () => {
        await mount(<PedidoDetalle />);
        await emit(DRAFT_EDIT);
        expect(gets('/orders/order-1')).toBe(0);
        await emit({ ...DRAFT_EDIT, order_id: 'order-1' });
        expect(gets('/orders/order-1')).toBe(1);
    });

    it('also refetches when an operation on another order touched this one (merge, split)', async () => {
        await mount(<PedidoDetalle />);
        await emit({ ...KITCHEN, order_id: 'order-9', related_order_ids: ['order-1'] });
        expect(gets('/orders/order-1')).toBe(1);
    });

    it('follows table and catalog events for what else it shows', async () => {
        await mount(<PedidoDetalle />);
        await emit(TABLE);
        expect(fetched('/orders/order-1', '/tables', '/products')).toEqual({ '/orders/order-1': 0, '/tables': 1, '/products': 0 });
        await emit(CATALOG);
        expect(fetched('/orders/order-1', '/tables', '/products')).toEqual({ '/orders/order-1': 0, '/tables': 1, '/products': 1 });
    });

    it('an event without a topic refreshes the order whatever its id', async () => {
        await mount(<PedidoDetalle />);
        await emit({ ...LEGACY, order_id: 'order-9' });
        expect(gets('/orders/order-1')).toBe(1);
    });
});

describe('Caja', () => {
    const urls = ['/cash/current', '/orders', '/tables', '/payments'];

    it('a composer tap refreshes the pending accounts, not the register, the tables or the payments', async () => {
        mockUser = CASHIER;
        await mount(<Caja />);
        await emit(DRAFT_EDIT);
        expect(fetched(...urls)).toEqual({ '/cash/current': 0, '/orders': 1, '/tables': 0, '/payments': 0 });
    });

    it('a payment refreshes the register, the pending accounts and the payments, not the tables', async () => {
        mockUser = CASHIER;
        await mount(<Caja />);
        await emit(PAYMENT);
        expect(fetched(...urls)).toEqual({ '/cash/current': 1, '/orders': 1, '/tables': 0, '/payments': 1 });
    });

    it('a cash event refreshes only the register; a table event only the tables', async () => {
        mockUser = CASHIER;
        await mount(<Caja />);
        await emit(CASH);
        expect(fetched(...urls)).toEqual({ '/cash/current': 1, '/orders': 0, '/tables': 0, '/payments': 0 });
        await emit(TABLE);
        expect(fetched(...urls)).toEqual({ '/cash/current': 1, '/orders': 0, '/tables': 1, '/payments': 0 });
    });

    it('an event without a topic refreshes everything', async () => {
        mockUser = CASHIER;
        await mount(<Caja />);
        await emit(LEGACY);
        expect(fetched(...urls)).toEqual({ '/cash/current': 1, '/orders': 1, '/tables': 1, '/payments': 1 });
    });
});
