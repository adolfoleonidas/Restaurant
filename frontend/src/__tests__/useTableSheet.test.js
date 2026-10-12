import { act } from 'react';
import { toast } from 'sonner';
import useTableSheet from '@/pages/salon/useTableSheet';
import {
    addOrderItems, createOrder, getOrder, listOrders, mergeOrder, moveOrder, moveOrderItem, removeOrderItem,
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
    moveOrderItem: jest.fn(),
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

const apis = {
    addOrderItems, createOrder, getOrder, listOrders, mergeOrder, moveOrder, moveOrderItem, removeOrderItem,
    sendOrderToKitchen, setOrderAlias, splitOrder, updateOrderItem, voidOrderItem,
};
const refreshAll = jest.fn();
let mounted;

const mount = async (props = {}) => {
    mounted = await renderHook((p) => useTableSheet(p), {
        tables: [], orders: [], activeOrders: {}, canTake: true, refreshAll, ...props,
    });
    return mounted;
};

beforeEach(() => {
    mockLive = null;
    refreshAll.mockReset();
    Object.values(apis).forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
    listOrders.mockResolvedValue({ data: [] });
    Object.values(toast).forEach((fn) => fn.mockReset());
    window.confirm = jest.fn(() => true);
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useTableSheet: opening and closing', () => {
    test('opens a table with its order, its other accounts and its history', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'en_preparacion' } });
        const current = order('o1', 't1', { items: [item('a', 'pendiente')] });
        const other = order('o2', 't1', { items: [item('b', 'pendiente')] });
        const closed = order('o9', 't1', { status: 'pagado' });
        getOrder.mockResolvedValue({ data: current });
        listOrders.mockResolvedValue({ data: [current, other, closed] });
        const { result } = await mount();

        await act(async () => { await result.current.openSheet(busy); });
        expect(getOrder).toHaveBeenCalledWith('o1');
        expect(listOrders).toHaveBeenCalledWith({ table_id: 't1', limit: 50 });
        expect(result.current.openTable.order).toEqual(current);
        expect(result.current.openTable.accounts).toEqual([current, other]);
        expect(result.current.openTable.history).toEqual([closed]);
        expect(result.current.openTable.loading).toBe(false);
        expect(result.current.composerOpen).toBe(false);

        await act(async () => { await result.current.closeSheet(); });
        expect(result.current.openTable).toBeNull();
    });

    test('a draft account of a composable table opens the menu by itself', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'nuevo' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador')] }) });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(busy); });
        expect(result.current.composerOpen).toBe(true);
    });

    test('a role that cannot take orders never gets the menu opened', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'nuevo' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador')] }) });
        const { result } = await mount({ canTake: false });
        await act(async () => { await result.current.openSheet(busy); });
        expect(result.current.composerOpen).toBe(false);
    });

    test('without an order of its own, the sheet follows the first open account of the table', async () => {
        const free = table('t1', 1, { status: 'ocupada' });
        const only = order('o1', 't1', { items: [item('a', 'pendiente')] });
        listOrders.mockResolvedValue({ data: [only] });
        getOrder.mockResolvedValue({ data: only });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(free); });
        expect(getOrder).toHaveBeenCalledWith('o1');
        expect(result.current.openTable.accountId).toBe('o1');
        expect(result.current.openTable.order.id).toBe('o1');
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

    test('does not open another table while a write is in flight or the sheet is loading', async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        let release;
        getOrder.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const { result } = await mount();
        let first;
        await act(async () => { first = result.current.openSheet(t); });
        expect(result.current.openTable.loading).toBe(true);
        let second;
        await act(async () => { second = await result.current.openSheet(table('t2', 2)); });
        expect(second).toBeNull();
        expect(result.current.openTable.table.id).toBe('t1');
        await act(async () => { release({ data: order('o1', 't1') }); await first; });
    });

    test('taking an order is refused to roles that cannot take tables and for paid tables', async () => {
        const { result } = await mount({ canTake: false });
        await act(async () => { await result.current.takeOrderInline(table('t1', 1)); });
        expect(toast.info).toHaveBeenCalledWith('Solo el mozo puede tomar la mesa');
        expect(result.current.openTable).toBeNull();

        await mounted.rerender({ tables: [], orders: [], activeOrders: {}, canTake: true, refreshAll });
        await act(async () => { await result.current.takeOrderInline(table('t1', 1, { status: 'pagada' })); });
        expect(toast.info).toHaveBeenCalledWith('Liberá la mesa pagada antes de tomar pedido');
        expect(result.current.openTable).toBeNull();
    });

    test('the sheet remembers the last open account for the mini player', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const current = order('o1', 't1');
        getOrder.mockResolvedValue({ data: current });
        const { result } = await mount({ orders: [current] });
        await act(async () => { await result.current.openSheet(busy); });
        expect(result.current.lastOpened).toMatchObject({ tableId: 't1', accountId: 'o1', account: current });
        await act(async () => { await result.current.closeSheet(); });
        expect(result.current.lastOpened.accountId).toBe('o1');
        expect(result.current.miniOrder).toBe(current);
    });

    test('Escape closes the sheet unless a dialog or menu is open', async () => {
        const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { items: [item('a', 'pendiente')] }) });
        const { result } = await mount();
        await act(async () => { await result.current.openSheet(busy); });

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('data-state', 'open');
        document.body.appendChild(dialog);
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        expect(result.current.openTable).not.toBeNull();
        dialog.remove();

        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        expect(result.current.openTable).toBeNull();
    });
});

describe('useTableSheet: ordering', () => {
    const open = async (extra = {}, tableExtra = {}) => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' }, ...tableExtra });
        getOrder.mockResolvedValue({ data: order('o1', 't1', { items: [item('a', 'borrador', { quantity: 2 })] }) });
        const view = await mount({ tables: [t], ...extra });
        await act(async () => { await view.result.current.openSheet(t); });
        return view;
    };

    test('the first product of a free table creates the account, then adds the product', async () => {
        const free = table('t2', 2);
        createOrder.mockResolvedValue({ data: order('o5', 't2', { status: 'nuevo' }) });
        getOrder.mockResolvedValue({ data: order('o5', 't2', { status: 'nuevo' }) });
        const { result } = await mount({ tables: [free] });
        await act(async () => { await result.current.openSheet(free); });
        await act(async () => { await result.current.addProductToAccount({ id: 'prod-1' }); });
        expect(createOrder).toHaveBeenCalledWith({ table_id: 't2', order_type: 'mesa' });
        expect(addOrderItems).toHaveBeenCalledWith('o5', [{ product_id: 'prod-1', quantity: 1 }]);
        expect(refreshAll).toHaveBeenCalled();
        expect(result.current.savingItem).toBe(false);
    });

    test('a second person on an open visit is requested as a new account', async () => {
        const { result } = await open({}, { active_attention_id: 'att-1' });
        await act(async () => { result.current.startNewAccount(); });
        expect(result.current.openTable.order).toBeNull();
        expect(result.current.composerOpen).toBe(true);
        createOrder.mockResolvedValue({ data: order('o6', 't1', { status: 'nuevo' }) });
        await act(async () => { await result.current.addProductToAccount({ id: 'prod-2' }); });
        expect(createOrder).toHaveBeenCalledWith({ table_id: 't1', order_type: 'mesa', new_account: true });
        expect(addOrderItems).toHaveBeenCalledWith('o6', [{ product_id: 'prod-2', quantity: 1 }]);
    });

    test('tapping a product that already has an unannotated draft line adds one unit there', async () => {
        const { result } = await open();
        await act(async () => { await result.current.addProductToAccount({ id: 'p-a' }); });
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { quantity: 3 });
        expect(addOrderItems).not.toHaveBeenCalled();
    });

    test('a sent line or an annotated line is never merged', async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        getOrder.mockResolvedValue({
            data: order('o1', 't1', { items: [item('a', 'pendiente'), item('b', 'borrador', { notes: 'sin sal' })] }),
        });
        const { result } = await mount({ tables: [t] });
        await act(async () => { await result.current.openSheet(t); });
        await act(async () => { await result.current.addProductToAccount({ id: 'p-a' }); });
        await act(async () => { await result.current.addProductToAccount({ id: 'p-b' }); });
        expect(updateOrderItem).not.toHaveBeenCalled();
        expect(addOrderItems).toHaveBeenCalledTimes(2);
    });

    test('lowering a quantity to zero removes the line, otherwise it updates it', async () => {
        const { result } = await open();
        await act(async () => { await result.current.changeItemQty({ id: 'a', quantity: 2 }, -1); });
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { quantity: 1 });
        await act(async () => { await result.current.changeItemQty({ id: 'a', quantity: 1 }, -1); });
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
    });

    test('item notes are saved on the line of the chosen account', async () => {
        const { result } = await open();
        await act(async () => { await result.current.saveItemNotes({ id: 'a' }, 'Sin cebolla'); });
        expect(updateOrderItem).toHaveBeenCalledWith('o1', 'a', { notes: 'Sin cebolla' });
        await act(async () => { await result.current.saveItemNotesFor('o2', { id: 'z' }, 'Poco picante'); });
        expect(updateOrderItem).toHaveBeenCalledWith('o2', 'z', { notes: 'Poco picante' });
    });

    test('voiding a product reports it and sends the reason', async () => {
        const { result } = await open();
        await act(async () => { await result.current.voidProduct({ id: 'a' }, 'Error de pedido'); });
        expect(voidOrderItem).toHaveBeenCalledWith('o1', 'a', { reason: 'Error de pedido' });
        expect(toast.success).toHaveBeenCalledWith('Producto anulado');
    });

    test('moving a line to another person names the source account', async () => {
        const { result } = await open();
        await act(async () => { await result.current.moveItemToPerson({ id: 'a' }, 'o2'); });
        expect(moveOrderItem).toHaveBeenCalledWith('o1', 'a', { target_order_id: 'o2' });
        expect(toast.success).toHaveBeenCalledWith('Producto movido de persona');
        await act(async () => { await result.current.moveItemToPerson({ id: 'b' }, 'o3', 'o9'); });
        expect(moveOrderItem).toHaveBeenCalledWith('o9', 'b', { target_order_id: 'o3' });
    });

    test('nothing is written when the role cannot take orders', async () => {
        const { result } = await open({ canTake: false });
        await act(async () => { await result.current.changeItemQty({ id: 'a', quantity: 2 }, -1); });
        await act(async () => { await result.current.voidProduct({ id: 'a' }, 'x'); });
        await act(async () => { await result.current.saveItemNotes({ id: 'a' }, 'x'); });
        expect(updateOrderItem).not.toHaveBeenCalled();
        expect(voidOrderItem).not.toHaveBeenCalled();
    });

    test('renaming a person patches the alias and keeps the shared flag', async () => {
        const { result } = await open();
        getOrder.mockResolvedValue({ data: order('o1', 't1', { customer_name: 'Ana', items: [item('a', 'borrador', { quantity: 2 })] }) });
        await act(async () => { await result.current.renamePerson('o1', 'Ana'); });
        expect(setOrderAlias).toHaveBeenCalledWith('o1', { alias: 'Ana', shared: false });
        expect(result.current.openTable.order.customer_name).toBe('Ana');
        expect(result.current.openTable.accounts.find((a) => a.id === 'o1').customer_name).toBe('Ana');
        await act(async () => { await result.current.renamePerson('o1', ''); });
        expect(setOrderAlias).toHaveBeenLastCalledWith('o1', { alias: null, shared: false });
    });

    test('closing the card editor only saves when the alias changed', async () => {
        const { result } = await open();
        const view = { id: 'o1', customer_name: 'Ana' };
        await act(async () => { result.current.setCardRenameId('o1'); result.current.setCardRenameDraft(' Ana '); });
        await act(async () => { result.current.commitCardRename(view); });
        expect(setOrderAlias).not.toHaveBeenCalled();
        expect(result.current.cardRenameId).toBeNull();
        await act(async () => { result.current.setCardRenameId('o1'); result.current.setCardRenameDraft('Luis'); });
        await act(async () => { result.current.commitCardRename(view); });
        expect(setOrderAlias).toHaveBeenCalledWith('o1', { alias: 'Luis', shared: false });
    });
});

describe('useTableSheet: leaving the menu and discarding drafts', () => {
    const openDraft = async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'nuevo' } });
        const draft = order('o1', 't1', { status: 'nuevo', items: [item('a', 'borrador'), item('b', 'borrador')] });
        getOrder.mockResolvedValue({ data: draft });
        const view = await mount({ tables: [t] });
        await act(async () => { await view.result.current.openSheet(t); });
        return view;
    };

    test('leaving with drafts asks first and removes only the drafts', async () => {
        const { result } = await openDraft();
        expect(result.current.composerOpen).toBe(true);
        window.confirm.mockReturnValueOnce(false);
        await act(async () => { await result.current.leaveComposer(); });
        expect(removeOrderItem).not.toHaveBeenCalled();
        expect(result.current.composerOpen).toBe(true);

        await act(async () => { await result.current.leaveComposer(); });
        expect(window.confirm).toHaveBeenLastCalledWith('¿Descartar los productos sin enviar antes de salir?');
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'a');
        expect(removeOrderItem).toHaveBeenCalledWith('o1', 'b');
        expect(result.current.composerOpen).toBe(false);
    });

    test('closing the table from the menu also resets the overlays', async () => {
        const { result } = await openDraft();
        await act(async () => { result.current.setSummaryOpen(true); result.current.setReceiptOpen(true); });
        await act(async () => { await result.current.leaveComposer({ closeTable: true }); });
        expect(result.current.openTable).toBeNull();
        expect(result.current.summaryOpen).toBe(false);
        expect(result.current.receiptOpen).toBe(false);
    });

    test('a failed discard keeps the menu and reports the error', async () => {
        const { result } = await openDraft();
        removeOrderItem.mockRejectedValue({ response: { data: { detail: 'No se puede' } } });
        await act(async () => { await result.current.leaveComposer(); });
        expect(toast.error).toHaveBeenCalledWith('No se puede');
        expect(result.current.composerOpen).toBe(true);
    });

    test('clearing the ticket confirms before deleting drafts', async () => {
        const { result } = await openDraft();
        window.confirm.mockReturnValueOnce(false);
        await act(async () => { await result.current.clearDraft(); });
        expect(removeOrderItem).not.toHaveBeenCalled();
        await act(async () => { await result.current.clearDraft(); });
        expect(window.confirm).toHaveBeenLastCalledWith('¿Vaciar los productos sin enviar? Los productos enviados se conservarán.');
        expect(removeOrderItem).toHaveBeenCalledTimes(2);
    });
});

describe('useTableSheet: sending to the kitchen', () => {
    const openDraft = async (status = 'nuevo', items = [item('a', 'borrador')]) => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const current = order('o1', 't1', { status, items });
        getOrder.mockResolvedValue({ data: current });
        const view = await mount({ tables: [t] });
        await act(async () => { await view.result.current.openSheet(t); });
        return { ...view, current };
    };

    test('the first send saves the alias, announces the table and clears the screen for the next person', async () => {
        const { result, current } = await openDraft();
        sendOrderToKitchen.mockResolvedValue({ data: { ...current, status: 'en_preparacion', customer_name: 'Juan' } });
        await act(async () => { result.current.setAliasDraft('Juan'); });
        let sent;
        await act(async () => { sent = await result.current.sendCurrentToKitchen(); });

        expect(sent).toBe(true);
        expect(setOrderAlias).toHaveBeenCalledWith('o1', { alias: 'Juan', shared: false });
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
        expect(toast.success).toHaveBeenCalledWith('Enviado a cocina · Mesa 1');
        expect(result.current.composerOpen).toBe(false);
        expect(result.current.openTable.order).toBeNull();
        expect(result.current.openTable.accountId).toBeNull();
        expect(result.current.openTable.accounts.map((a) => a.id)).toEqual(['o1']);
        expect(result.current.reviewOrderId).toBeNull();
        expect(result.current.sendingToKitchen).toBe(false);
    });

    test('a later send reports how many additional items travelled', async () => {
        const { result, current } = await openDraft('en_preparacion', [item('a', 'pendiente'), item('b', 'borrador')]);
        sendOrderToKitchen.mockResolvedValue({ data: { ...current, status: 'en_preparacion' } });
        await act(async () => { await result.current.sendCurrentToKitchen(); });
        expect(toast.success).toHaveBeenCalledWith('Enviados 1 adicionales');
    });

    test('a click event passed as the first argument is not taken for an account id', async () => {
        const { result, current } = await openDraft();
        sendOrderToKitchen.mockResolvedValue({ data: current });
        await act(async () => { await result.current.sendCurrentToKitchen({ type: 'click' }); });
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
    });

    test('a failure keeps the sheet as it was and shows the server detail', async () => {
        const { result } = await openDraft();
        sendOrderToKitchen.mockRejectedValue({ response: { data: { detail: 'Cocina cerrada' } } });
        let sent;
        await act(async () => { sent = await result.current.sendCurrentToKitchen(); });
        expect(sent).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Cocina cerrada');
        expect(result.current.openTable.order.id).toBe('o1');
        expect(result.current.sendingToKitchen).toBe(false);
    });

    test('requesting a send opens the review and only the confirmation sends', async () => {
        const { result, current } = await openDraft();
        sendOrderToKitchen.mockResolvedValue({ data: current });
        await act(async () => { result.current.requestSend(); });
        expect(result.current.reviewOrderId).toBe('o1');
        expect(result.current.reviewOrder.id).toBe('o1');
        expect(result.current.reviewItems).toHaveLength(1);
        expect(sendOrderToKitchen).not.toHaveBeenCalled();

        await act(async () => { await result.current.confirmReviewedSend(); });
        expect(sendOrderToKitchen).toHaveBeenCalledWith('o1');
        expect(result.current.reviewOrderId).toBeNull();
    });

    test('returning to edit from the review reloads the account and reopens the menu', async () => {
        const { result, current } = await openDraft('en_preparacion', [item('a', 'pendiente'), item('b', 'borrador')]);
        expect(result.current.composerOpen).toBe(false);
        await act(async () => { result.current.requestSend(); });
        expect(result.current.reviewOrderId).toBe('o1');
        getOrder.mockResolvedValue({ data: current });
        await act(async () => { await result.current.returnToEdit(); });
        expect(result.current.reviewOrderId).toBeNull();
        expect(result.current.composerOpen).toBe(true);
    });
});

describe('useTableSheet: several accounts', () => {
    const openTwo = async (extra = {}) => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const o1 = order('o1', 't1', { items: [item('a', 'pendiente')] });
        const o2 = order('o2', 't1', { items: [item('b', 'pendiente')] });
        getOrder.mockResolvedValue({ data: o1 });
        listOrders.mockResolvedValue({ data: [o1, o2] });
        const view = await mount({ tables: [t], ...extra });
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

    test('a failed account load falls back to the account already in view', async () => {
        const { result } = await openTwo();
        getOrder.mockRejectedValue(new Error('offline'));
        let loaded;
        await act(async () => { loaded = await result.current.selectAccount('o2'); });
        expect(loaded).toBeNull();
        expect(result.current.openTable.accountId).toBe('o1');
        expect(result.current.openTable.loading).toBe(false);
    });

    test('editing an account loads a fresh copy and opens the menu on it', async () => {
        const t = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
        const o1 = order('o1', 't1', { items: [item('a', 'pendiente')] });
        const o2 = order('o2', 't1', { status: 'nuevo', items: [item('b', 'borrador')] });
        getOrder.mockImplementation(async (id) => ({ data: id === 'o2' ? o2 : o1 }));
        listOrders.mockResolvedValue({ data: [o1, o2] });
        const { result } = await mount({ tables: [t] });
        await act(async () => { await result.current.openSheet(t); });
        await flush();
        expect(result.current.composerOpen).toBe(false);
        await act(async () => { await result.current.editAccount(o2); });
        expect(result.current.openTable.order.id).toBe('o2');
        expect(result.current.composerOpen).toBe(true);
    });
});
