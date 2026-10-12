import {
    STATE_FILTERS,
    SORT_NUMERO,
    SORT_PRIORIDAD,
    readSortMode,
    rememberSortMode,
    priorityScore,
    unitZone,
    floorState,
    groupFloorState,
    itemQty,
    accountDue,
    accountKitchenState,
    accountTally,
    tallyLabel,
    isComposingDraft,
    isComposableTable,
    canComposeAccountAt,
    accountSnapshots,
    indexOrdersByTable,
    summarizeOrders,
    floorSummaryText,
    projectPickups,
    listAreas,
    decorateTables,
    buildUnits,
    countByState,
    filterUnits,
    sumFloorDue,
    buildZoneSections,
    freeTablesForAccountMove,
    selectFreshOrder,
    selectSheetModel,
    selectMiniOrder,
    selectReviewOrder,
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
    const items = [
        item('a', 'listo', 2), item('b', 'pendiente', 1), item('c', 'entregado', 3),
        item('d', 'cancelado', 5), item('e', 'en_preparacion', 1), item('f', 'borrador', 2),
    ];

    test('itemQty sums quantities that match', () => {
        expect(itemQty(items, (it) => it.status === 'listo')).toBe(2);
        expect(itemQty(null, () => true)).toBe(0);
    });

    test('accountDue is the total minus what was paid, never negative', () => {
        expect(accountDue({ total: 30, amount_paid: 10 })).toBe(20);
        expect(accountDue({ total: 30, amount_paid: 50 })).toBe(0);
        expect(accountDue({ total: '12.5' })).toBe(12.5);
        expect(accountDue(null)).toBe(0);
    });

    test('accountTally counts real drafts only and ignores cancelled items', () => {
        expect(accountTally({ status: 'en_preparacion', items })).toEqual({ ready: 2, drafts: 2, kitchen: 2, served: 3 });
        expect(accountTally(null)).toEqual({ ready: 0, drafts: 0, kitchen: 0, served: 0 });
    });

    test('accountKitchenState delegates to the per-order tag', () => {
        expect(accountKitchenState([item('a', 'borrador')], 'nuevo').key).toBe('draft');
        expect(accountKitchenState([item('a', 'listo')], 'listo').key).toBe('ready');
        expect(accountKitchenState([], 'nuevo').key).toBe('empty');
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

describe('composable accounts', () => {
    const open = table('t1', 1, { status: 'ocupada', active_attention_id: 'att-1' });
    const account = order('o1', 't1', { order_type: 'mesa', attention_id: 'att-1', attention_state: 'open', branch_id: 'b1' });

    test('only free or seated tables are composable', () => {
        expect(isComposableTable(table('t', 1))).toBe(true);
        expect(isComposableTable(table('t', 1, { status: 'ocupada' }))).toBe(true);
        expect(isComposableTable(table('t', 1, { status: 'pagada' }))).toBe(false);
        expect(isComposableTable(table('t', 1, { status: 'reservada' }))).toBe(false);
        expect(isComposableTable(null)).toBe(false);
    });

    test('an account can be composed only inside its own open visit and branch', () => {
        expect(canComposeAccountAt(account, open)).toBe(true);
        expect(canComposeAccountAt(null, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, status: 'pagado' }, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, status: 'cancelado' }, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, table_id: 'other' }, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, order_type: 'recojo' }, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, attention_state: 'closed' }, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, attention_id: 'att-2' }, open)).toBe(false);
        expect(canComposeAccountAt({ ...account, branch_id: 'b2' }, open)).toBe(false);
        expect(canComposeAccountAt(account, { ...open, status: 'pagada' })).toBe(false);
        // An explicit attention id overrides the table one.
        expect(canComposeAccountAt({ ...account, attention_id: 'att-2' }, open, 'att-2')).toBe(true);
    });

    test('accountSnapshots replaces, appends or ignores foreign accounts', () => {
        const sheet = { table: { id: 't1' }, accounts: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] };
        expect(accountSnapshots(sheet, { id: 'a', v: 2 })).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }]);
        expect(accountSnapshots(sheet, { id: 'c', table_id: 't1' }).map((a) => a.id)).toEqual(['a', 'b', 'c']);
        expect(accountSnapshots(sheet, { id: 'd', table_id: 'other' }).map((a) => a.id)).toEqual(['a', 'b']);
        expect(accountSnapshots(sheet, null)).toBe(sheet.accounts);
        expect(accountSnapshots({ table: { id: 't1' } }, { id: 'x', table_id: 't1' }).map((a) => a.id)).toEqual(['x']);
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

describe('sort preference', () => {
    beforeEach(() => window.localStorage.clear());

    test('defaults to number order and remembers the choice per user', () => {
        expect(readSortMode('u1')).toBe(SORT_NUMERO);
        rememberSortMode('u1', SORT_PRIORIDAD);
        expect(readSortMode('u1')).toBe(SORT_PRIORIDAD);
        expect(readSortMode('u2')).toBe(SORT_NUMERO);
        expect(window.localStorage.getItem('salon-orden:u1')).toBe(SORT_PRIORIDAD);
        expect(readSortMode(null)).toBe(SORT_NUMERO);
    });

    test('a blocked storage falls back to number order without throwing', () => {
        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        const spySet = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        expect(readSortMode('u1')).toBe(SORT_NUMERO);
        expect(() => rememberSortMode('u1', SORT_PRIORIDAD)).not.toThrow();
        spy.mockRestore();
        spySet.mockRestore();
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
    const orders = [order('o1', 't1', { status: 'listo', total: 30, amount_paid: 10, items: [item('a', 'listo')], created_at: '2026-01-01T10:00:00Z' })];
    const activeOrders = ordersByTable(orders);
    const build = () => {
        const byTable = indexOrdersByTable(orders);
        const decorated = decorateTables({ tables, byTable, orders, activeOrders });
        return { decorated, units: buildUnits({ decorated, tables, activeOrders }) };
    };
    const filter = (units, extra = {}) => filterUnits(units, {
        areaFilter: 'todas', stateFilter: 'todas', search: '', sortMode: SORT_NUMERO, ...extra,
    }).map((u) => u.anchorNumber);

    test('listAreas drops empty zones and prepends "todas"', () => {
        expect(listAreas([...tables, table('t5', 5, { area: '' })])).toEqual(['todas', 'Terraza', 'Salón']);
        expect(listAreas(null)).toEqual(['todas']);
    });

    test('decorateTables derives the card data', () => {
        const { decorated } = build();
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
        const { units } = build();
        expect(units.map((u) => u.type).sort()).toEqual(['group', 'single', 'single']);
        const groupUnit = units.find((u) => u.type === 'group');
        expect(groupUnit.numbers).toEqual([3, 4]);
        expect(groupUnit.anchorNumber).toBe(3);
        expect(groupUnit.accounts).toBe(0);
        expect(groupUnit.urgency).toBeNull();
        expect(groupUnit.amount).toBeNull();
        expect(groupUnit.createdAt).toBeNull();
        const single = units.find((u) => u.type === 'single' && u.anchorNumber === 1);
        expect(single.createdAt).toBe('2026-01-01T10:00:00Z');
    });

    test('countByState and filterUnits follow the visible cards', () => {
        const { units } = build();
        const counts = countByState(units);
        expect(counts).toEqual({ todas: 3, libre: 1, activas: 1, listo: 1, cuenta: 0 });
        expect(Object.keys(counts)).toEqual(STATE_FILTERS.map((f) => f.key));
        expect(filter(units)).toEqual([1, 2, 3]);
        expect(filter(units, { areaFilter: 'Terraza' })).toEqual([1]);
        expect(filter(units, { stateFilter: 'libre' })).toEqual([2]);
        expect(filter(units, { stateFilter: 'activas' })).toEqual([3]);
        expect(filter(units, { stateFilter: 'listo' })).toEqual([1]);
        expect(filter(units, { search: 'mesa 4' })).toEqual([3]);
    });

    test('priority order puts what claims action first and breaks ties by anchor number', () => {
        const { units } = build();
        // Mesa 1 is "listo" (5000), Mesa 3 is "sentados" (3000), Mesa 2 is free (0).
        expect(filter(units, { sortMode: SORT_PRIORIDAD })).toEqual([1, 3, 2]);
        const tied = [2, 1].map((n) => ({
            type: 'single', anchorNumber: n, floor: { key: 'libre' }, createdAt: null, entry: { table: table(`x${n}`, n) },
        }));
        expect(priorityScore(tied[0])).toBe(0);
        expect(filter(tied, { sortMode: SORT_PRIORIDAD })).toEqual([1, 2]);
    });

    test('sumFloorDue adds every pending balance, groups included', () => {
        const { units } = build();
        expect(sumFloorDue(units)).toBe(20);
        const grouped = [{ type: 'group', members: [{ due: 5 }, { due: 7 }] }, { type: 'single', entry: { due: 3 } }];
        expect(sumFloorDue(grouped)).toBe(15);
        expect(sumFloorDue([])).toBe(0);
    });

    test('unitZone is the anchor zone, or the matching member under a zone filter', () => {
        const mixed = {
            type: 'group',
            members: [{ table: { area: 'Salón' } }, { table: { area: 'Terraza' } }],
            anchor: { table: { area: 'Salón' } },
        };
        expect(unitZone(mixed, 'todas')).toBe('Salón');
        expect(unitZone(mixed, 'Terraza')).toBe('Terraza');
        expect(unitZone({ type: 'single', entry: { table: { area: '' } } }, 'todas')).toBe('Sin zona');
    });

    test('buildZoneSections keeps the floor zone order and appends unknown zones', () => {
        const { units } = build();
        const visible = filterUnits(units, { areaFilter: 'todas', stateFilter: 'todas', search: '', sortMode: SORT_NUMERO });
        const areas = listAreas(tables);
        const sections = buildZoneSections(visible, areas, 'todas');
        expect(sections.map((s) => s.area)).toEqual(['Terraza', 'Salón']);
        expect(sections[0].units.map((u) => u.anchorNumber)).toEqual([1]);
        expect(sections[1].units.map((u) => u.anchorNumber)).toEqual([2, 3]);
        const stray = buildZoneSections(visible, ['todas', 'Terraza'], 'todas');
        expect(stray.map((s) => s.area)).toEqual(['Terraza', 'Salón']);
        expect(buildZoneSections([], areas, 'todas')).toEqual([]);
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

describe('selectFreshOrder', () => {
    const open = { id: 'o1', updated_at: '2026-01-01T10:00:00Z' };

    test('keeps the open order without a matching live snapshot', () => {
        expect(selectFreshOrder(null, { id: 'o1' })).toBeNull();
        expect(selectFreshOrder(open, null)).toBe(open);
        expect(selectFreshOrder(open, [{ id: 'o1' }])).toBe(open);
        expect(selectFreshOrder(open, { id: 'other', updated_at: '2030' })).toBe(open);
    });

    test('takes the live snapshot only when it is at least as fresh', () => {
        const newer = { id: 'o1', updated_at: '2026-01-01T10:00:05Z' };
        const older = { id: 'o1', updated_at: '2026-01-01T09:59:00Z' };
        expect(selectFreshOrder(open, newer)).toBe(newer);
        expect(selectFreshOrder(open, older)).toBe(open);
        const same = { id: 'o1', updated_at: open.updated_at };
        expect(selectFreshOrder(open, same)).toBe(same);
    });
});

describe('selectSheetModel', () => {
    const t = table('t1', 1, { status: 'ocupada', active_attention_id: 'att-1', active_order: { id: 'o1', status: 'en_preparacion' } });
    const o1 = order('o1', 't1', {
        attention_id: 'att-1', attention_state: 'open', customer_name: 'Juan', total: 40, amount_paid: 10,
        items: [item('a', 'pendiente', 2), item('b', 'borrador', 1)],
    });
    const o2 = order('o2', 't1', { attention_id: 'att-1', attention_state: 'open', total: 10, amount_paid: 0, items: [item('c', 'entregado', 1)] });
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
        expect(model.persons.map((p) => [p.id, p.label, p.alias])).toEqual([['o1', 'Juan', 'Juan'], ['o2', 'Persona 2', '']]);
        expect(model.persons[0].draftCount).toBe(1);
        expect(model.personAccounts).toHaveLength(2);
        expect(model.cards.map((c) => c.id)).toEqual(['o1', 'o2']);
        expect(model.tableDishes).toBe(4);
        expect(model.tableTotal).toBe(40);
        expect(model.tableConsumido).toBe(50);
        expect(model.tablePagado).toBe(10);
        expect(model.tablePendiente).toBe(40);
        expect(model.pendingCount).toBe(1);
        expect(model.draftUnits).toBe(1);
        expect(model.orderItems).toHaveLength(2);
        expect(model.hasAccount).toBe(true);
        expect(model.sendState.kind).toBe('extra');
        expect(model.sendState.count).toBe(1);
        expect(model.showSend).toBe(true);
        expect(model.actionOrder).toBe(o1);
        expect(model.actionAccountId).toBe('o1');
        expect(model.actionDue).toBe(30);
    });

    test('the account being composed joins the cards without becoming a person', () => {
        const fresh = order('o3', 't1', { status: 'nuevo', items: [item('d', 'borrador', 1)] });
        const model = selectSheetModel({
            ...base,
            sheetOrder: fresh,
            openTable: { ...base.openTable, order: fresh, accountId: 'o3', accounts: [o1, o2] },
            activeOrders: ordersByTable([o1, o2, fresh]),
        });
        expect(model.cards.map((c) => c.id)).toEqual(['o1', 'o2', 'o3']);
        expect(model.persons.map((p) => p.id)).toEqual(['o1', 'o2']);
        expect(model.currentAccountId).toBe('o3');
    });

    test('with a cleared screen the actions fall back to the first person', () => {
        const model = selectSheetModel({ ...base, sheetOrder: null, openTable: { ...base.openTable, order: null, accountId: null, table: { ...t, active_order: null } } });
        expect(model.order).toBeNull();
        expect(model.hasAccount).toBe(true);
        expect(model.actionAccountId).toBe('o1');
        expect(model.actionOrder.id).toBe('o1');
        expect(model.sendState).toBeNull();
        expect(model.showSend).toBe(false);
        expect(model.draftUnits).toBe(0);
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

    test('composing follows the live table status, not the stale sheet copy', () => {
        const paidNow = { ...t, status: 'pagada' };
        expect(selectSheetModel({ ...base, tables: [paidNow] }).canCompose).toBe(false);
        expect(selectSheetModel({ ...base, tables: [] }).canCompose).toBe(true);
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

describe('selectReviewOrder', () => {
    test('looks the reviewed account up in the freshest source first', () => {
        const sheetOrder = { id: 'a', from: 'sheet' };
        const open = { order: { id: 'a', from: 'open' }, accounts: [{ id: 'a', from: 'list' }] };
        const mini = { id: 'a', from: 'mini' };
        expect(selectReviewOrder({ reviewOrderId: null, sheetOrder, openTable: open, miniOrder: mini })).toBeNull();
        expect(selectReviewOrder({ reviewOrderId: 'a', sheetOrder, openTable: open, miniOrder: mini }).from).toBe('sheet');
        expect(selectReviewOrder({ reviewOrderId: 'a', sheetOrder: null, openTable: open, miniOrder: mini }).from).toBe('open');
        expect(selectReviewOrder({ reviewOrderId: 'a', sheetOrder: null, openTable: { order: null, accounts: [{ id: 'a', from: 'list' }] }, miniOrder: mini }).from).toBe('mini');
        expect(selectReviewOrder({ reviewOrderId: 'a', sheetOrder: null, openTable: { accounts: [{ id: 'a', from: 'list' }] }, miniOrder: null }).from).toBe('list');
        expect(selectReviewOrder({ reviewOrderId: 'zzz', sheetOrder: { id: 'a' }, openTable: null, miniOrder: null })).toBeUndefined();
    });
});
