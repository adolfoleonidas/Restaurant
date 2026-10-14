import { act } from 'react';
import useSalonData from '@/pages/salon/useSalonData';
import { listTables } from '@/lib/api/tables';
import { listOrders } from '@/lib/api/orders';
import { listProducts } from '@/lib/api/products';
import { listCategories } from '@/lib/api/categories';
import { renderHook, flush } from '@/test-utils/renderHook';

// Filled by the mocked `useRealtimeGeneration` (the `mock` prefix is what lets
// the hoisted factory reach it); reset per test in `beforeEach`.
var mockSubscriptions = [];

jest.mock('@/lib/api/tables', () => ({ listTables: jest.fn() }));
jest.mock('@/lib/api/orders', () => ({ listOrders: jest.fn() }));
jest.mock('@/lib/api/products', () => ({ listProducts: jest.fn() }));
jest.mock('@/lib/api/categories', () => ({ listCategories: jest.fn() }));
jest.mock('@/contexts/NotifyContext', () => ({
    useRealtimeGeneration: (topics, filter) => {
        mockSubscriptions.push({ topics, filter });
        return 0;
    },
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const tables = [{ id: 't1', number: 1 }];
const orders = [{ id: 'o1', table_id: 't1' }];
const base = {
    isOwner: false, scope: null, scopeKey: 'sin-alcance', scopeParams: null, scopePending: false,
};
let mounted;

const mount = async (props) => {
    mounted = await renderHook((p) => useSalonData(p), props);
    await flush();
    return mounted;
};

beforeEach(() => {
    mockSubscriptions = [];
    listTables.mockReset().mockImplementation((params) => Promise.resolve({
        data: params?.legacy_only ? [{ id: 'x' }, { id: 'y' }] : tables,
    }));
    listOrders.mockReset().mockResolvedValue({ data: orders });
    listProducts.mockReset().mockResolvedValue({ data: [{ id: 'p1' }] });
    listCategories.mockReset().mockResolvedValue({ data: [{ id: 'c1' }] });
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useSalonData', () => {
    test('loads the floor, the live orders and the menu', async () => {
        const { result } = await mount(base);
        expect(listTables).toHaveBeenCalledWith(null);
        expect(listOrders).toHaveBeenCalledWith({ active_only: true });
        expect(result.current.tables).toEqual(tables);
        expect(result.current.orders).toEqual(orders);
        expect(result.current.products).toEqual([{ id: 'p1' }]);
        expect(result.current.categories).toEqual([{ id: 'c1' }]);
        expect(result.current.unassignedCount).toBe(0);
        expect(result.current.tablesError).toBeNull();
    });

    test('scopes both floor requests to the chosen branch', async () => {
        await mount({ ...base, scope: 'branch:a', scopeKey: 'branch:a', scopeParams: { branch_id: 'a' } });
        expect(listTables).toHaveBeenCalledWith({ branch_id: 'a' });
        expect(listOrders).toHaveBeenCalledWith({ active_only: true, branch_id: 'a' });
    });

    test('asks for nothing on the floor while the branch scope is still pending', async () => {
        const { result } = await mount({ ...base, isOwner: true, scopePending: true });
        expect(listTables).not.toHaveBeenCalled();
        expect(listOrders).not.toHaveBeenCalled();
        expect(result.current.tables).toBeNull();
        expect(result.current.orders).toEqual([]);
    });

    test('the owner is told how many tables belong to no branch', async () => {
        const { result } = await mount({
            ...base, isOwner: true, scope: 'branch:a', scopeKey: 'branch:a', scopeParams: { branch_id: 'a' },
        });
        expect(listTables).toHaveBeenCalledWith({ legacy_only: true });
        expect(result.current.unassignedCount).toBe(2);
    });

    test('nobody else, and nobody viewing the legacy floor, loads the unassigned tables', async () => {
        await mount({ ...base, isOwner: true, scope: 'legacy', scopeKey: 'legacy', scopeParams: { legacy_only: true } });
        const legacyCalls = listTables.mock.calls.filter(([params]) => params?.legacy_only);
        // the legacy floor itself is requested once; the separate "unassigned" poll never runs
        expect(legacyCalls).toHaveLength(1);
    });

    test('refreshAll refetches the tables and the orders', async () => {
        const { result } = await mount(base);
        listTables.mockClear();
        listOrders.mockClear();
        await act(async () => { result.current.refreshAll(); });
        await flush();
        expect(listTables).toHaveBeenCalledTimes(1);
        expect(listOrders).toHaveBeenCalledTimes(1);
    });
});

describe('useSalonData: el parche optimista del piso', () => {
    // Un pedido vivo, con lo que la tarjeta necesita para pintarse: id, estado,
    // total y sus platos.
    const liveOrder = {
        id: 'o1', table_id: 't1', attention_id: 'att-1', attention_state: 'open',
        status: 'listo', total: 45, amount_paid: 0,
        items: [{ id: 'i1', status: 'listo', subtotal: 45 }],
    };
    const liveTable = { id: 't1', number: 1, active_order: liveOrder };

    beforeEach(() => {
        listTables.mockImplementation((params) => Promise.resolve({ data: params?.legacy_only ? [] : [liveTable] }));
        listOrders.mockResolvedValue({ data: [liveOrder] });
    });

    test('una función devuelve el parche, no el pedido entero', async () => {
        // El síntoma que lo destapó: al pulsar «Entregar» el monto de la mesa
        // cambiaba y volvía, y el estado no se movía hasta abrir el pedido. La
        // causa era esta: el pedido quedaba reducido a `{ items }`, así que la
        // tarjeta perdía `status` y `total` —caía a «Ocupada» y sin importe—
        // hasta que llegaba el refresco.
        const { result } = await mount(base);
        act(() => {
            result.current.patchOrder('o1', (order) => ({
                items: order.items.map((it) => ({ ...it, status: 'entregado' })),
            }));
        });

        const patched = result.current.orders[0];
        expect(patched).toMatchObject({ id: 'o1', table_id: 't1', status: 'listo', total: 45, amount_paid: 0 });
        expect(patched.items[0].status).toBe('entregado');
        // La mesa lleva el mismo pedido embebido, y también conserva lo suyo.
        expect(result.current.tables[0].active_order).toMatchObject({ id: 'o1', status: 'listo', total: 45 });
        expect(result.current.tables[0].active_order.items[0].status).toBe('entregado');
        expect(result.current.tables[0].number).toBe(1);
    });

    test('un objeto también se fusiona sobre el pedido vivo', async () => {
        const { result } = await mount(base);
        act(() => { result.current.patchOrder('o1', { status: 'pagado' }); });

        expect(result.current.orders[0]).toMatchObject({ id: 'o1', status: 'pagado', total: 45 });
        expect(result.current.orders[0].items[0].status).toBe('listo');
        expect(result.current.tables[0].active_order).toMatchObject({ id: 'o1', status: 'pagado' });
    });

    test('solo toca el pedido que se le nombra', async () => {
        const other = { ...liveOrder, id: 'o2', table_id: 't2' };
        listOrders.mockResolvedValue({ data: [liveOrder, other] });
        listTables.mockImplementation((params) => Promise.resolve({
            data: params?.legacy_only ? [] : [liveTable, { id: 't2', number: 2, active_order: other }],
        }));
        const { result } = await mount(base);
        act(() => { result.current.patchOrder('o1', { status: 'pagado' }); });

        expect(result.current.orders.map((o) => o.status)).toEqual(['pagado', 'listo']);
        expect(result.current.tables[1].active_order.status).toBe('listo');
    });
});

describe('useSalonData: the waiter does not re-read the floor for his own taps (TB-03)', () => {
    const floorFilter = () => {
        const entry = mockSubscriptions.find(({ topics }) => topics.includes('tables'));
        return entry && entry.filter;
    };

    test('the tables and the orders ignore the echo of this same user own changes', async () => {
        await mount(base);
        const filter = floorFilter();
        expect(typeof filter).toBe('function');

        // His own batch: the write already answered with the order.
        expect(filter({ type: 'order', extra: 'draft_lines', actor_user_id: 'u1' })).toBe(false);
        // Another waiter's batch: the floor must still follow it.
        expect(filter({ type: 'order', extra: 'draft_lines', actor_user_id: 'mozo-2' })).toBe(true);
        // Nobody named (an older backend): refresh, as before.
        expect(filter({ type: 'order', extra: 'draft_lines' })).toBe(true);
        // Editing and sending already refreshed on purpose in this same device, so
        // its own echo is not worth another round of requests.
        expect(filter({ type: 'order', extra: 'items_added', actor_user_id: 'u1' })).toBe(false);
        expect(filter({ type: 'order', extra: 'item_removed', actor_user_id: 'u1' })).toBe(false);
        expect(filter({ type: 'order', extra: 'item_updated', actor_user_id: 'u1' })).toBe(false);
        expect(filter({ type: 'order', extra: 'item_voided', actor_user_id: 'u1' })).toBe(false);
        expect(filter({ type: 'order', extra: 'send_to_kitchen', actor_user_id: 'u1' })).toBe(false);
        // Somebody else editing is not an echo.
        expect(filter({ type: 'order', extra: 'items_added', actor_user_id: 'mozo-2' })).toBe(true);
        // The floor itself always refreshes, even when this user caused it: the local
        // state is not enough to know how the floor ended up.
        expect(filter({ type: 'table', actor_user_id: 'u1' })).toBe(true);
        expect(filter({})).toBe(true);
    });

    test('the orders subscription of the live list follows the same rule', async () => {
        await mount(base);
        // The hook subscribes again on every render, so the array holds one entry
        // per render: every one of them carries the same rule.
        const ownList = mockSubscriptions.filter(({ topics }) => topics.join('|') === 'orders');
        expect(ownList.length).toBeGreaterThan(0);
        ownList.forEach(({ filter }) => {
            expect(filter({ extra: 'draft_lines', actor_user_id: 'u1' })).toBe(false);
            expect(filter({ extra: 'draft_lines', actor_user_id: 'mozo-2' })).toBe(true);
        });
    });
});
