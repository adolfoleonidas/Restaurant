import {
    STATE_FILTERS,
    floorState,
    groupFloorState,
    itemQty,
    itemPending,
    accountTally,
    tallyLabel,
    isComposingDraft,
    indexOrdersByTable,
    summarizeOrders,
    floorSummaryText,
    projectPickups,
    listAreas,
    decorateTables,
    buildUnits,
    countByState,
    filterUnits,
    freeTablesForAccountMove,
    selectSheetModel,
    selectMiniOrder,
    isMiniVisible,
} from '@/pages/salon/selectors';
import { ordersByTable } from '@/lib/tableGroups';

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4, status: 'disponible',
    branch_id: 'b1', active_order: null, active_attention_id: null, group: null, ...extra,
});

const item = (id, status, quantity = 1, extra = {}) => ({
    id, product_id: `p-${id}`, product_name: `Plato ${id}`, status, quantity, unit_price: 10, subtotal: 10 * quantity, ...extra,
});

const order = (id, tableId, extra = {}) => ({
    id, order_number: Number(id.replace(/\D/g, '')) || 1, table_id: tableId, status: 'en_preparacion',
    total: 30, amount_paid: 0, items: [], ...extra,
});

describe('floorState', () => {
    test.each([
        [table('t', 1, { status: 'inactiva' }), 'inactiva'],
        [table('t', 1, { status: 'reservada' }), 'reservada'],
        [table('t', 1, { active_order: { status: 'cancelado' } }), 'atencion'],
        [table('t', 1, { active_order: { status: 'pagado' } }), 'pagada'],
        [table('t', 1, { status: 'pagada' }), 'pagada'],
        [table('t', 1), 'libre'],
        [table('t', 1, { status: 'esperando_pago' }), 'cuenta'],
        [table('t', 1, { active_order: { status: 'pendiente_pago' } }), 'cuenta'],
        [table('t', 1, { active_order: { status: 'listo' } }), 'listo'],
        [table('t', 1, { active_order: { status: 'entregado' } }), 'entregado'],
        [table('t', 1, { active_order: { status: 'en_preparacion' } }), 'preparando'],
        [table('t', 1, { active_order: { status: 'nuevo' } }), 'preparando'],
        [table('t', 1, { status: 'ocupada' }), 'sentados'],
    ])('%#', (t, key) => {
        expect(floorState(t)).toEqual({ key });
    });

    test('a group inherits the most urgent member state', () => {
        const members = [{ floor: { key: 'libre' } }, { floor: { key: 'cuenta' } }, { floor: { key: 'listo' } }];
        expect(groupFloorState(members)).toEqual({ key: 'cuenta' });
        expect(groupFloorState([{ floor: { key: 'sentados' } }, { floor: { key: 'preparando' } }])).toEqual({ key: 'preparando' });
    });
});

describe('item and account tallies', () => {
    const items = [item('a', 'listo', 2), item('b', 'pendiente', 1), item('c', 'entregado', 3), item('d', 'cancelado', 5), item('e', 'en_preparacion', 1)];

    test('itemQty sums quantities that match', () => {
        expect(itemQty(items, (it) => it.status === 'listo')).toBe(2);
        expect(itemQty(null, () => true)).toBe(0);
    });

    test('itemPending is anything not delivered or cancelled', () => {
        expect(itemPending({ status: 'pendiente' })).toBe(true);
        expect(itemPending({})).toBe(true);
        expect(itemPending({ status: 'entregado' })).toBe(false);
        expect(itemPending({ status: 'cancelado' })).toBe(false);
    });

    test('accountTally ignores cancelled items', () => {
        expect(accountTally({ items })).toEqual({ ready: 2, drafts: 4, kitchen: 2, served: 3 });
        expect(accountTally(null)).toEqual({ ready: 0, drafts: 0, kitchen: 0, served: 0 });
    });

    test('tallyLabel names the most urgent state first', () => {
        expect(tallyLabel({ ready: 2, drafts: 4, kitchen: 1, served: 1 })).toBe('Listo para servir · 2');
        expect(tallyLabel({ ready: 0, drafts: 4, kitchen: 1, served: 1 })).toBe('Por enviar · 4');
        expect(tallyLabel({ ready: 0, drafts: 0, kitchen: 1, served: 1 })).toBe('En cocina · 1');
        expect(tallyLabel({ ready: 0, drafts: 0, kitchen: 0, served: 2 })).toBe('Servido · 2');
        expect(tallyLabel({ ready: 0, drafts: 0, kitchen: 0, served: 0 })).toBe('Sin platos todavía');
    });

    test('isComposingDraft is true while nothing left the kitchen queue', () => {
        expect(isComposingDraft(null)).toBe(false);
        expect(isComposingDraft({ status: 'nuevo', items: [] })).toBe(true);
        expect(isComposingDraft({ status: 'nuevo', items: [{ status: 'borrador' }] })).toBe(true);
        expect(isComposingDraft({ status: 'en_preparacion', items: [{ status: 'pendiente' }] })).toBe(false);
    });
});

describe('order level selectors', () => {
    const orders = [
        order('o1', 't1', { items: [item('a', 'listo', 2), item('b', 'pendiente', 1)], total: 30, amount_paid: 10 }),
        order('o2', 't2', { items: [item('c', 'entregado', 1)], total: 10, amount_paid: 10 }),
        order('o3', null, { order_type: 'recojo', status: 'en_preparacion', items: [item('d', 'en_preparacion', 2)] }),
    ];

    test('summarizeOrders counts kitchen items, ready items and open bills', () => {
        expect(summarizeOrders(orders)).toEqual({ toPrep: 3, toReady: 2, toPay: 2 });
        expect(summarizeOrders([])).toEqual({ toPrep: 0, toReady: 0, toPay: 0 });
    });

    test('floorSummaryText is the screen reader line, naming the unit of each count', () => {
        expect(floorSummaryText({ toPrep: 1, toReady: 2, toPay: 3 }))
            .toBe('En cocina 1 plato · listos 2 platos · por cobrar 3 mesas');
        expect(floorSummaryText({ toPrep: 0, toReady: 1, toPay: 1 }))
            .toBe('En cocina 0 platos · listos 1 plato · por cobrar 1 mesa');
    });

    test('summarizeOrders leaves unsent drafts out of kitchen and bill counts', () => {
        const mixed = [
            order('o1', 't1', { status: 'nuevo', total: 40, items: [item('a', 'borrador', 2)] }),
            order('o2', 't2', { status: 'en_preparacion', total: 30, items: [item('b', 'borrador', 1), item('c', 'pendiente', 2)] }),
        ];
        expect(summarizeOrders(mixed)).toEqual({ toPrep: 2, toReady: 0, toPay: 1 });
    });

    test('indexOrdersByTable keeps the last order per table', () => {
        const map = indexOrdersByTable([order('o1', 't1'), order('o2', 't1'), order('o3', null)]);
        expect(Object.keys(map)).toEqual(['t1']);
        expect(map.t1.id).toBe('o2');
    });

    test('projectPickups keeps active takeout orders without a table', () => {
        const mixed = [
            ...orders,
            order('o4', null, { order_type: 'recojo', status: 'entregado' }),
            order('o5', 't9', { order_type: 'recojo', status: 'listo' }),
        ];
        const { active, prior } = projectPickups(mixed);
        expect(active.map((o) => o.id)).toEqual(['o3']);
        expect(prior).toEqual([]);
    });
});

describe('floor units', () => {
    const t1 = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1', status: 'listo' }, area: 'Terraza' });
    const t2 = table('t2', 2);
    const t3 = table('t3', 3, { status: 'ocupada' });
    const group = { id: 'g1', anchor_table_id: 't3', table_ids: ['t3', 't4'] };
    const t4 = table('t4', 4, { group });
    const t3g = { ...t3, group };
    const tables = [t1, t2, t3g, t4];
    const orders = [order('o1', 't1', { status: 'listo', total: 30, amount_paid: 10, items: [item('a', 'listo')] })];
    const activeOrders = ordersByTable(orders);

    test('listAreas drops empty zones and prepends "todas"', () => {
        expect(listAreas([...tables, table('t5', 5, { area: '' })])).toEqual(['todas', 'Terraza', 'Salón']);
        expect(listAreas(null)).toEqual(['todas']);
    });

    test('decorateTables derives the card data', () => {
        const byTable = indexOrdersByTable(orders);
        const decorated = decorateTables({ tables, byTable, orders, activeOrders });
        expect(decorated).toHaveLength(4);
        const first = decorated[0];
        expect(first.floor).toEqual({ key: 'listo' });
        expect(first.ready).toBe(1);
        expect(first.due).toBe(20);
        expect(first.billRequested).toBe(false);
        expect(first.groupBadge).toBeNull();
        const grouped = decorated[2];
        expect(grouped.group.id).toBe('g1');
        expect(grouped.groupBadge.accounts).toBe(0);
        expect(grouped.groupNumbers).toEqual([3, 4]);
    });

    test('decorateTables sums what every open order of the visit owes', () => {
        const visitTable = table('tv', 7, { status: 'ocupada', active_attention_id: 'att-9', active_order: { id: 'v1', status: 'en_preparacion' } });
        const visitOrders = [
            order('v1', 'tv', { attention_id: 'att-9', attention_state: 'open', total: 30, amount_paid: 10, items: [item('a', 'pendiente')] }),
            order('v2', 'tv', { attention_id: 'att-9', attention_state: 'open', total: 25, amount_paid: 0, items: [item('b', 'entregado')] }),
            order('v3', 'tv', { attention_id: 'att-9', attention_state: 'open', status: 'pagado', total: 99, amount_paid: 99, items: [item('c', 'entregado')] }),
            order('v4', 'tv', { attention_id: 'att-9', attention_state: 'open', status: 'nuevo', total: 12, amount_paid: 0, items: [item('d', 'borrador')] }),
        ];
        const decorated = decorateTables({
            tables: [visitTable], byTable: indexOrdersByTable(visitOrders), orders: visitOrders, activeOrders: ordersByTable(visitOrders),
        });
        expect(decorated[0].due).toBe(45);
    });

    test('buildUnits folds a group into one unit and keeps singles', () => {
        const byTable = indexOrdersByTable(orders);
        const decorated = decorateTables({ tables, byTable, orders, activeOrders });
        const units = buildUnits({ decorated, tables, activeOrders });
        expect(units.map((u) => u.type).sort()).toEqual(['group', 'single', 'single']);
        const groupUnit = units.find((u) => u.type === 'group');
        expect(groupUnit.numbers).toEqual([3, 4]);
        expect(groupUnit.anchorNumber).toBe(3);
        expect(groupUnit.accounts).toBe(0);
        expect(groupUnit.urgency).toBeNull();
        expect(groupUnit.amount).toBeNull();
    });

    test('countByState and filterUnits follow the visible cards', () => {
        const byTable = indexOrdersByTable(orders);
        const decorated = decorateTables({ tables, byTable, orders, activeOrders });
        const units = buildUnits({ decorated, tables, activeOrders });
        const counts = countByState(units);
        expect(counts).toEqual({ todas: 3, libre: 1, activas: 1, listo: 1, cuenta: 0 });
        expect(Object.keys(counts)).toEqual(STATE_FILTERS.map((f) => f.key));

        const all = filterUnits(units, { areaFilter: 'todas', stateFilter: 'todas', search: '' });
        expect(all.map((u) => u.anchorNumber)).toEqual([1, 2, 3]);
        expect(filterUnits(units, { areaFilter: 'Terraza', stateFilter: 'todas', search: '' }).map((u) => u.anchorNumber)).toEqual([1]);
        expect(filterUnits(units, { areaFilter: 'todas', stateFilter: 'libre', search: '' }).map((u) => u.anchorNumber)).toEqual([2]);
        expect(filterUnits(units, { areaFilter: 'todas', stateFilter: 'activas', search: '' }).map((u) => u.anchorNumber)).toEqual([3]);
        expect(filterUnits(units, { areaFilter: 'todas', stateFilter: 'listo', search: '' }).map((u) => u.anchorNumber)).toEqual([1]);
        expect(filterUnits(units, { areaFilter: 'todas', stateFilter: 'todas', search: 'mesa 4' }).map((u) => u.anchorNumber)).toEqual([3]);
    });

    test('freeTablesForAccountMove excludes busy tables and the open one', () => {
        const free = [
            table('a', 1), table('b', 2, { status: 'ocupada' }), table('c', 3, { active_order: { id: 'x' } }),
            table('d', 4, { active_attention_id: 'v' }), table('e', 5),
        ];
        expect(freeTablesForAccountMove(free, 'e').map((t) => t.id)).toEqual(['a']);
        expect(freeTablesForAccountMove(null, null)).toEqual([]);
    });
});

describe('selectSheetModel', () => {
    const t = table('t1', 1, { status: 'ocupada', active_attention_id: 'att-1', active_order: { id: 'o1', status: 'en_preparacion' } });
    const o1 = order('o1', 't1', {
        attention_id: 'att-1', attention_state: 'open', customer_name: 'Juan',
        items: [item('a', 'pendiente', 2), item('b', 'borrador', 1)],
    });
    const o2 = order('o2', 't1', { attention_id: 'att-1', attention_state: 'open', items: [item('c', 'entregado', 1)] });
    const perms = { canTake: true, canClose: true };
    const base = {
        openTable: { table: t, order: o1, history: null, group: null, accountTable: null, loading: false, accounts: [o1, o2], accountId: 'o1' },
        sheetOrder: o1,
        tables: [t],
        activeOrders: ordersByTable([o1, o2]),
        ...perms,
    };

    test('the sheet follows the live table, not the snapshot taken when it opened', () => {
        const live = { ...t, status: 'esperando_pago', active_order: { id: 'o1', status: 'pendiente_pago' } };
        const model = selectSheetModel({ ...base, tables: [live] });
        expect(model.floor).toEqual({ key: 'cuenta' });
        expect(model.table.status).toBe('esperando_pago');
    });

    test('derives persons, summary rows and totals', () => {
        const model = selectSheetModel(base);
        expect(model.floor).toEqual({ key: 'preparando' });
        expect(model.canCompose).toBe(true);
        expect(model.currentAccountId).toBe('o1');
        expect(model.persons.map((p) => [p.id, p.label])).toEqual([['o1', 'Juan'], ['o2', 'Persona 2']]);
        expect(model.persons[0].draftCount).toBe(1);
        expect(model.personAccounts).toHaveLength(2);
        expect(model.tableDishes).toBe(4);
        expect(model.tableTotal).toBe(40);
        expect(model.pendingCount).toBe(1);
        expect(model.orderItems).toHaveLength(2);
        expect(model.hasAccount).toBe(true);
        expect(model.sendState).toEqual({ kind: 'extra', count: 1, label: '✈ Enviar adicionales (1)' });
        expect(model.showSend).toBe(true);
        expect(model.actionOrder).toBe(o1);
        expect(model.actionAccountId).toBe('o1');
    });

    test('with a cleared screen the actions fall back to the first person', () => {
        const model = selectSheetModel({ ...base, sheetOrder: null, openTable: { ...base.openTable, order: null, accountId: null, table: { ...t, active_order: null } } });
        expect(model.order).toBeNull();
        expect(model.hasAccount).toBe(true);
        expect(model.actionAccountId).toBe('o1');
        expect(model.actionOrder.id).toBe('o1');
        expect(model.sendState).toBeNull();
        expect(model.showSend).toBe(false);
    });

    test('a free table with no account cannot be closed and offers composing', () => {
        const free = table('t2', 2);
        const model = selectSheetModel({
            ...base,
            tables: [free],
            activeOrders: {},
            sheetOrder: null,
            openTable: { table: free, order: null, history: null, group: null, accountTable: null, loading: false, accounts: [], accountId: null },
        });
        expect(model.hasAccount).toBe(false);
        expect(model.canCompose).toBe(true);
        expect(model.closeable).toBe(false);
        expect(model.persons).toEqual([]);
    });

    test('cooks and cashiers cannot compose', () => {
        const model = selectSheetModel({ ...base, canTake: false });
        expect(model.canCompose).toBe(false);
    });
});

describe('mini player selectors', () => {
    const t = table('t1', 1);
    const tracked = { tableId: 't1', accountId: 'o1', table: t, account: order('o1', 't1', { status: 'nuevo' }) };

    test('selectMiniOrder prefers the live order and hides settled ones', () => {
        const live = order('o1', 't1', { status: 'listo' });
        expect(selectMiniOrder([live], tracked)).toBe(live);
        expect(selectMiniOrder([], tracked)).toBe(tracked.account);
        expect(selectMiniOrder([order('o1', 't1', { status: 'pagado' })], tracked)).toBeNull();
        expect(selectMiniOrder([], null)).toBeNull();
        expect(selectMiniOrder([order('o1', 'other', { status: 'listo' })], tracked)).toBe(tracked.account);
    });

    test('isMiniVisible hides while any overlay is open', () => {
        const flags = { miniOrder: {}, openTable: null, showNewOrder: false, transferSource: null, moveAccountId: null, selectMode: false };
        expect(isMiniVisible(flags)).toBe(true);
        expect(isMiniVisible({ ...flags, miniOrder: null })).toBe(false);
        expect(isMiniVisible({ ...flags, openTable: {} })).toBe(false);
        expect(isMiniVisible({ ...flags, showNewOrder: true })).toBe(false);
        expect(isMiniVisible({ ...flags, transferSource: {} })).toBe(false);
        expect(isMiniVisible({ ...flags, moveAccountId: 'o1' })).toBe(false);
        expect(isMiniVisible({ ...flags, selectMode: true })).toBe(false);
    });
});
