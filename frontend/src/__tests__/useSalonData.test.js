import { act } from 'react';
import useSalonData from '@/pages/salon/useSalonData';
import { listTables } from '@/lib/api/tables';
import { listOrders } from '@/lib/api/orders';
import { listProducts } from '@/lib/api/products';
import { listCategories } from '@/lib/api/categories';
import { renderHook, flush } from '@/test-utils/renderHook';

jest.mock('@/lib/api/tables', () => ({ listTables: jest.fn() }));
jest.mock('@/lib/api/orders', () => ({ listOrders: jest.fn() }));
jest.mock('@/lib/api/products', () => ({ listProducts: jest.fn() }));
jest.mock('@/lib/api/categories', () => ({ listCategories: jest.fn() }));

const tables = [{ id: 't1', number: 1 }];
const orders = [{ id: 'o1', table_id: 't1' }];
const base = {
    generation: 0, isOwner: false, scope: null, scopeKey: 'sin-alcance', scopeParams: null, scopePending: false,
};
let mounted;

const mount = async (props) => {
    mounted = await renderHook((p) => useSalonData(p), props);
    await flush();
    return mounted;
};

beforeEach(() => {
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
