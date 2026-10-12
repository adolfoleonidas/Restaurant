import {
    canJoinSelection,
    canTransferVisit,
    groupAccountTable,
    groupAccountTables,
    groupAnchor,
    groupLabel,
    groupMembers,
    groupMembership,
    orderOwnsTable,
    ordersByTable,
    selectionProblem,
    tableHasAccount,
    transferCandidates,
    transferProblem,
} from '@/lib/tableGroups';

const table = (id, number, extra = {}) => ({
    id, number, area: 'Salón', capacity: 4, status: 'disponible', branch_id: 'branch-1',
    active_order: null, ...extra,
});

const visit = (tableId, extra = {}) => ({
    id: `order-${tableId}`, table_id: tableId, attention_id: `visit-${tableId}`,
    attention_state: 'open', status: 'en_preparacion', total: 30, amount_paid: 0, items: [], ...extra,
});

const group = (tableIds, extra = {}) => ({
    id: 'group-1', name: `Mesas ${tableIds.length}`, anchor_table_id: tableIds[0],
    table_ids: tableIds, ...extra,
});

describe('floor order ownership', () => {
    it('keeps a table owned while the order is unsettled', () => {
        expect(orderOwnsTable(visit('t1', { status: 'listo' }))).toBe(true);
        expect(orderOwnsTable({ status: 'pagado', attention_state: 'open' })).toBe(true);
        expect(orderOwnsTable({ status: 'pagado', attention_state: 'closed' })).toBe(false);
        expect(orderOwnsTable({ status: 'cancelado', attention_state: 'closed' })).toBe(false);
        expect(orderOwnsTable(null)).toBe(false);
    });

    it('maps only the orders that still own a table', () => {
        const orders = [
            visit('t1'),
            { id: 'settled', table_id: 't2', status: 'pagado', attention_state: 'closed' },
            { id: 'pickup', table_id: null, status: 'listo' },
        ];
        expect(Object.keys(ordersByTable(orders))).toEqual(['t1']);
    });

    it('reads an account from the live poll or from the table snapshot', () => {
        expect(tableHasAccount(table('t1', 1), { t1: visit('t1') })).toBe(true);
        expect(tableHasAccount(table('t2', 2, { active_order: { id: 'o' } }), {})).toBe(true);
        expect(tableHasAccount(table('t3', 3), {})).toBe(false);
    });
});

describe('group reading', () => {
    const tables = [table('t2', 2), table('t1', 1, { status: 'ocupada' }), table('t3', 3)];
    const joined = group(['t2', 't1'], { name: null });

    it('resolves members in table-number order', () => {
        expect(groupMembers(joined, tables).map((t) => t.number)).toEqual([1, 2]);
        expect(groupMembers(null, tables)).toEqual([]);
    });

    it('labels the group by its name or by its member numbers', () => {
        expect(groupLabel(joined, tables)).toBe('Mesas 1 + 2');
        expect(groupLabel({ ...joined, name: 'Cumpleaños' }, tables)).toBe('Cumpleaños');
    });

    it('falls back to the lowest-numbered member when the anchor left', () => {
        expect(groupAnchor(group(['t9', 't2'], { anchor_table_id: 't9' }), tables).number).toBe(2);
        expect(groupAnchor(group(['t2', 't1']), tables).number).toBe(2);
    });

    it('points at the member that owns the account', () => {
        const withAccount = { t2: visit('t2') };
        expect(groupAccountTable(joined, tables, withAccount).number).toBe(2);
        const anchoredOnFirst = group(['t1', 't2'], { name: null });
        expect(groupAccountTable(anchoredOnFirst, tables, {}).number).toBe(1);
        expect(groupAccountTable(anchoredOnFirst, tables, withAccount).number).toBe(2);
    });

    it('lists every account a group holds, in table order', () => {
        const bothBills = { t1: visit('t1'), t2: visit('t2') };
        expect(groupAccountTables(joined, tables, bothBills).map((t) => t.number)).toEqual([1, 2]);
        expect(groupAccountTables(joined, tables, {})).toEqual([]);
        expect(groupAccountTables(null, tables, bothBills)).toEqual([]);
    });

    it('lists only the tables that belong to a group', () => {
        const withGroup = [table('t1', 1, { group: joined }), table('t3', 3)];
        expect(Object.keys(groupMembership(withGroup))).toEqual(['t1']);
    });
});

describe('joining a selection', () => {
    const free = [table('t1', 1), table('t2', 2)];

    it('accepts two free tables of the same branch', () => {
        expect(selectionProblem(free, {}, ['t1', 't2'])).toBeNull();
        expect(canJoinSelection(free, {}, ['t1', 't2'])).toBe(true);
    });

    it('needs at least two tables', () => {
        expect(selectionProblem(free, {}, ['t1'])).toMatch(/al menos dos mesas/);
        expect(canJoinSelection(free, {}, [])).toBe(false);
    });

    it('refuses a table that already belongs to a group', () => {
        const tables = [table('t1', 1, { group: group(['t1', 't2']) }), table('t2', 2)];
        expect(selectionProblem(tables, {}, ['t1', 't2'])).toBe('La mesa 1 ya está unida a otro grupo');
    });

    it('refuses a table whose visit is not materialized yet', () => {
        const tables = [table('t1', 1), table('t2', 2, { status: 'ocupada', active_attention_id: 'visit-x' })];
        expect(selectionProblem(tables, {}, ['t1', 't2'])).toBe('La mesa 2 tiene una visita en curso');
    });

    it('refuses tables that are not available for a joined party', () => {
        for (const status of ['reservada', 'inactiva', 'pagada', 'esperando_pago']) {
            const tables = [table('t1', 1), table('t2', 2, { status })];
            expect(selectionProblem(tables, {}, ['t1', 't2'])).toBe('La mesa 2 no está disponible para unir');
        }
    });

    it('refuses two running accounts and cross-branch selections', () => {
        const busy = [table('t1', 1), table('t2', 2), table('t3', 3)];
        const accounts = { t2: visit('t2'), t3: visit('t3') };
        // Two bills are allowed: joining never merges or moves them.
        expect(selectionProblem(busy, accounts, ['t2', 't3'])).toBeNull();
        expect(selectionProblem(busy, accounts, ['t1', 't2', 't3'])).toBeNull();

        const branches = [table('t1', 1), table('t2', 2, { branch_id: 'branch-2' })];
        expect(selectionProblem(branches, {}, ['t1', 't2'])).toBe('Las mesas deben pertenecer a la misma sucursal');
    });

    it('accepts a free table joining the one that owns the visit', () => {
        const tables = [table('t1', 1, { status: 'ocupada', active_attention_id: 'visit-t1' }), table('t2', 2)];
        expect(selectionProblem(tables, { t1: visit('t1') }, ['t1', 't2'])).toBeNull();
    });
});

describe('moving an open visit', () => {
    const source = table('t1', 1, { status: 'ocupada', active_order: { id: 'order-t1' } });
    const candidates = [
        table('t2', 2),
        table('t3', 3, { status: 'ocupada' }),
        table('t4', 4, { group: group(['t4', 't5']) }),
        table('t5', 5, { status: 'reservada' }),
        table('t6', 6, { branch_id: 'branch-2' }),
        table('t7', 7, { active_attention_id: 'visit-t7' }),
    ];

    it('offers the free tables of the same branch, in table order', () => {
        expect(transferCandidates(candidates, {}, source).map((t) => t.number)).toEqual([2, 3]);
    });

    it('never offers the source table or a table with its own account', () => {
        const tables = [...candidates, source];
        const withAccount = { t3: visit('t3') };
        expect(transferCandidates(tables, withAccount, source).map((t) => t.number)).toEqual([2]);
    });

    it('explains why a visit cannot be moved', () => {
        expect(transferProblem(source, {})).toBeNull();
        expect(canTransferVisit(source, {})).toBe(true);
        expect(transferProblem(table('t9', 9), {})).toMatch(/no tiene un pedido activo/);
        const joined = { ...source, group: group(['t1', 't2']) };
        expect(transferProblem(joined, {})).toMatch(/Sepárala del grupo/);
        expect(canTransferVisit(joined, {})).toBe(false);
    });
});
