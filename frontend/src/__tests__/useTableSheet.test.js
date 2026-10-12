import { act } from 'react';
import { toast } from 'sonner';
import useTableSheet from '@/pages/salon/useTableSheet';
import {
    addOrderItems, createOrder, getOrder, listOrders, mergeOrder, moveOrder, removeOrderItem,
    sendOrderToKitchen, setOrderAlias, splitOrder, updateOrderItem, voidOrderItem,
} from '@/lib/api/orders';
import { renderHook, flush } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({
    addOrderItems: jest.fn(),
    createOrder: jest.fn(),
    getOrder: jest.fn(),
    listOrders: jest.fn(),
    mergeOrder: jest.fn(),
    moveOrder: jest.fn(),
    removeOrderItem: jest.fn(),
    sendOrderToKitchen: jest.fn(),
    setOrderAlias: jest.fn(),
    splitOrder: jest.fn(),
    updateOrderItem: jest.fn(),
    voidOrderItem: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
let mockLive = null;
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: mockLive }) }));

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4, status: 'disponible',
    branch_id: 'b1', active_order: null, active_attention_id: null, group: null, ...extra,
});
const item = (id, status, extra = {}) => ({
    id, product_id: `p-${id}`, product_name: `Plato ${id}`, status, quantity: 1, subtotal: 10, ...extra,
});
const order = (id, tableId, extra = {}) => ({
    id, order_number: 7, table_id: tableId, status: 'en_preparacion', total: 10, items: [], ...extra,
});

const refreshAll = jest.fn();
let mounted;

const mount = async (props = {}) => {
    mounted = await renderHook((p) => useTableSheet(p), {
        tables: [], activeOrders: {}, canTake: true, refreshAll, ...props,
    });
    return mounted;
};

beforeEach(() => {
    mockLive = null;
    refreshAll.mockReset();
    Object.values({
        addOrderItems, createOrder, getOrder, listOrders, mergeOrder, moveOrder, removeOrderItem,
        sendOrderToKitchen, setOrderAlias, splitOrder, updateOrderItem, voidOrderItem,
    }).forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
    listOrders.mockResolvedValue({ data: [] });
    Object.values(toast).forEach((fn) => fn.mockReset());
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useTableSheet: opening and closing', () => {
    test('opens a table with its order and its other accounts', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'en_preparacion' } });
        const current = order('o1', 't1', { items: [item('a', 'pendiente')] });
        const closed = order('o9', 't1', { status: 'pagado' });
        getOrder.mockResolvedValue({ data: current });
        listOrders.mockResolvedValue({ data: [current, closed] });
        const { result } = await mount();

        await act(async () => { await result.current.openSheet(busy); });
        expect(getOrder).toHaveBeenCalledWith('o1');
        expect(listOrders).toHaveBeenCalledWith({ table_id: 't1', limit: 50 });
        expect(result.current.openTable.order).toEqual(current);
        expect(result.current.openTable.accounts).toEqual([current]);
        expect(result.current.openTable.history).toEqual([closed]);
        expect(result.current.openTable.loading).toBe(false);
        expect(result.current.composerOpen).toBe(false);

        act(() => result.current.closeSheet());
        expect(result.current.openTable).toBeNull();
    });

    test('a draft account opens the menu by itself', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'nuevo' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador')] }) });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(busy); });
        expect(result.current.composerOpen).toBe(true);
    });

    test('a joined table without its own order follows the only account of the group', async () => {
        const group = { id: 'g1', anchor_table_id: 't1', table_ids: ['t1', 't2'] };
        const owner = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' }, group });
        const joined = table('t2', 2, { group });
        getOrder.mockResolvedValue({ data: order('o1', 't1') });
        const { result } = await mount({ tables: [owner, joined], activeOrders: { t1: order('o1', 't1') } });
        await act(async () => { await result.current.openSheet(joined); });
        expect(getOrder).toHaveBeenCalledWith('o1');
        expect(result.current.openTable.accountTable.id).toBe('t1');
    });

    test('taking an order is refused to roles that cannot take tables and for paid tables', async () => {
        const { result } = await mount({ canTake: false });
        await act(async () => { await result.current.takeOrderInline(table('t1', 1)); });
        expect(toast.info).toHaveBeenCalledWith('Solo el mozo puede tomar la mesa');
        expect(result.current.openTable).toBeNull();

        await mounted.rerender({ tables: [], activeOrders: {}, canTake: true, refreshAll });
        await act(async () => { await result.current.takeOrderInline(table('t1', 1, { status: 'pagada' })); });
        expect(toast.info).toHaveBeenCalledWith('Libera la mesa pagada antes de tomar pedido');
        expect(result.current.openTable).toBeNull();
    });

    test('the sheet remembers the last open account for the mini player', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const current = order('o1', 't1');
        getOrder.mockResolvedValue({ data: current });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(busy); });
        expect(result.current.lastOpened).toMatchObject({ tableId: 't1', accountId: 'o1', account: current });
        act(() => result.current.closeSheet());
        expect(result.current.lastOpened.accountId).toBe('o1');
    });
});

describe('useTableSheet: ordering', () => {
    const open = async (extra = {}, tableExtra = {}) => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' }, ...tableExtra });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { items: [item('a', 'borrador', { quantity: 2 })] }) });
        const view = await mount(extra);
        await act(async () => { await view.result.current.openSheet(t); });
        return view;
    };

    test('the first product of a free table creates the account, then adds the product', async () => {
        const free = table('t2', 2);
        createOrder.mockResolvedValue({ data: order('o5', 't2', { status: 'nuevo' }) });
        getOrder.mockResolvedValue({ data: order('o5', 't2', { status: 'nuevo' }) });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(free); });
        await act(async () => { await result.current.addProductToAccount({ id: 'prod-1' }); });
        expect(createOrder).toHaveBeenCalledWith({ table_id: 't2', order_type: 'mesa' });
        expect(addOrderItems).toHaveBeenCalledWith('o5', [{ product_id: 'prod-1', quantity: 1 }]);
        expect(refreshAll).toHaveBeenCalled();
        expect(result.current.savingItem).toBe(false);
    });

    test('a second person on an open visit is requested as a new account', async () => {
        const { result } = await open({}, { active_attention_id: 'att-1' });
        await act(async () => { result.current.startAnotherPerson(); });
        createOrder.mockResolvedValue({ data: order('o6', 't1', { status: 'nuevo' }) });
        await act(async () => { await result.current.addProductToAccount({ id: 'prod-2' }); });
        expect(createOrder).toHaveBeenCalledWith({ table_id: 't1', order_type: 'mesa', new_account: true });
        expect(addOrderItems).toHaveBeenCalledWith('o6', [{ product_id: 'prod-2', quantity: 1 }]);
    });

    test('lowering a quantity to zero removes the line, otherwise it updates it', async () => {
        const { result } = await open();
        await act(async () => { await result.current.changeItemQty({ id: 'a', quantity: 2 }, -1); });
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { quantity: 1 });
        await act(async () => { await result.current.changeItemQty({ id: 'a', quantity: 1 }, -1); });
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
    });

    test('splitting a quantity note adds one annotated unit first and lowers the line after', async () => {
        const { result } = await open();
        await act(async () => { await result.current.applyItemNote({ id: 'a', product_id: 'p-a', quantity: 2 }, 'Sin cebolla'); });
        expect(addOrderItems).toHaveBeenCalledWith('o1', [{ product_id: 'p-a', quantity: 1, notes: 'Sin cebolla' }]);
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { quantity: 1 });
        const order1 = addOrderItems.mock.invocationCallOrder[0];
        const order2 = updateOrderItem.mock.invocationCallOrder[0];
        expect(order1).toBeLessThan(order2);
    });

    test('voiding a product reports it and sends the reason', async () => {
        const { result } = await open();
        await act(async () => { await result.current.voidProduct({ id: 'a' }, 'Error de pedido'); });
        expect(voidOrderItem).toHaveBeenCalledWith('o1', 'a', { reason: 'Error de pedido' });
        expect(toast.success).toHaveBeenCalledWith('Producto anulado');
    });

    test('nothing is written when the role cannot take orders', async () => {
        const { result } = await open({ canTake: false });
        await act(async () => { await result.current.changeItemQty({ id: 'a', quantity: 2 }, -1); });
        await act(async () => { await result.current.voidProduct({ id: 'a' }, 'x'); });
        expect(updateOrderItem).not.toHaveBeenCalled();
        expect(voidOrderItem).not.toHaveBeenCalled();
    });
});

describe('useTableSheet: sending to the kitchen', () => {
    test('sends the open account, saves the alias with it and clears the screen for the next person', async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const current = order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador')] });
        getOrder.mockResolvedValue({ data: current });
        sendOrderToKitchen.mockResolvedValue({ data: { ...current, status: 'en_preparacion', customer_name: 'Juan' } });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(t); });
        await act(async () => { result.current.setAliasDraft('Juan'); });
        await act(async () => { await result.current.sendCurrentToKitchen(); });

        expect(setOrderAlias).toHaveBeenCalledWith('o1', { alias: 'Juan', shared: false });
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
        // Characterization: the count is taken from the pre-send items with the new
        // status, so a first send still reads "adicionales" (recorded for stage 4).
        expect(toast.success).toHaveBeenCalledWith('Enviados 1 adicionales');
        expect(result.current.flash).toBe('✓ Pedido de Juan enviado. ¿Siguiente persona?');
        expect(result.current.composerOpen).toBe(false);
        expect(result.current.openTable.order).toBeNull();
        expect(result.current.openTable.accountId).toBeNull();
    });

    test('a click event passed as the first argument is not taken for an account id', async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador')] }) });
        sendOrderToKitchen.mockResolvedValue({ data: order('o1', 't1') });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(t); });
        await act(async () => { await result.current.sendCurrentToKitchen({ type: 'click' }); });
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
    });

    test('a failure keeps the sheet as it was and shows the server detail', async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1') });
        sendOrderToKitchen.mockRejectedValue({ response: { data: { detail: 'Cocina cerrada' } } });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(t); });
        await act(async () => { await result.current.sendCurrentToKitchen(); });
        expect(toast.error).toHaveBeenCalledWith('Cocina cerrada');
        expect(result.current.flash).toBeNull();
        expect(result.current.openTable.order.id).toBe('o1');
    });
});

describe('useTableSheet: several accounts', () => {
    const openTwo = async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const o1 = order('o1', 't1', { items: [item('a', 'pendiente')] });
        const o2 = order('o2', 't1', { items: [item('b', 'pendiente')] });
        getOrder.mockResolvedValue({ data: o1 });
        listOrders.mockResolvedValue({ data: [o1, o2] });
        const view = await mount();
        await act(async () => { await view.result.current.openSheet(t); });
        await flush();
        return view;
    };

    test('merges every other account into the selected one and closes the sheet', async () => {
        const { result } = await openTwo();
        await act(async () => { await result.current.mergeAccounts(); });
        expect(mergeOrder).toHaveBeenCalledTimes(1);
        expect(mergeOrder).toHaveBeenCalledWith('o1', { source_order_id: 'o2' });
        expect(toast.success).toHaveBeenCalledWith('Cuentas fusionadas');
        expect(result.current.openTable).toBeNull();
        expect(refreshAll).toHaveBeenCalled();
    });

    test('splits the account in N parts', async () => {
        const { result } = await openTwo();
        await act(async () => { await result.current.splitAccount(3); });
        expect(splitOrder).toHaveBeenCalledWith('o1', { parts: 3 });
        expect(toast.success).toHaveBeenCalledWith('Cuenta dividida en 3');
    });

    test('moves the chosen account to a free table', async () => {
        const { result } = await openTwo();
        await act(async () => { result.current.setMoveAccountId('o2'); });
        await act(async () => { await result.current.moveAccount('t9'); });
        expect(moveOrder).toHaveBeenCalledWith('o2', { target_table_id: 't9' });
        expect(result.current.moveAccountId).toBeNull();
        expect(result.current.openTable).toBeNull();
    });

    test('selecting another account loads it', async () => {
        const { result } = await openTwo();
        getOrder.mockResolvedValue({ data: order('o2', 't1', { customer_name: 'Ana' }) });
        await act(async () => { await result.current.selectAccount('o2'); });
        expect(result.current.openTable.accountId).toBe('o2');
        expect(result.current.openTable.order.customer_name).toBe('Ana');
    });
});
