import {
    anchorCandidates,
    canJoinSelection,
    canTransferVisit,
    extendProblem,
    groupAccountTable,
    groupAccountTables,
    groupAnchor,
    groupById,
    groupLabel,
    groupMembers,
    groupMembership,
    joinOperation,
    orderOwnsTable,
    ordersByTable,
    pickProblem,
    resolveAnchor,
    seatsOf,
    selectionGuidance,
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

describe('one selection, two operations', () => {
    // `name: null` deja que el rótulo se arme con los números de las mesas, que
    // es lo que el mozo lee en la barra.
    const joined = group(['t1', 't2'], { name: null, anchor_table_id: 't1' });
    const other = group(['t3', 't4'], { id: 'group-2', name: null, anchor_table_id: 't3' });
    const t1 = table('t1', 1, { status: 'ocupada', group: joined, active_attention_id: 'visit-t1' });
    const t2 = table('t2', 2, { status: 'ocupada', group: joined });
    const t3 = table('t3', 3, { status: 'ocupada', group: other });
    const t4 = table('t4', 4, { status: 'ocupada', group: other });
    const t5 = table('t5', 5);
    const t6 = table('t6', 6, { branch_id: 'branch-2' });
    const floor = [t1, t2, t5, t6];
    const twoGroups = [...floor, t3, t4];

    it('reads seats only when every table states its capacity', () => {
        expect(seatsOf([table('a', 1, { capacity: 4 }), table('b', 2, { capacity: 2 })])).toBe(6);
        expect(seatsOf([table('a', 1, { capacity: 4 }), table('b', 2, { capacity: 0 })])).toBeNull();
        expect(seatsOf([])).toBeNull();
    });

    it('finds a group by id from the tables of the floor', () => {
        expect(groupById(floor, 'group-1').id).toBe('group-1');
        expect(groupById(floor, 'nope')).toBeNull();
        expect(groupById(floor, null)).toBeNull();
    });

    it('picking a joined table means the whole group', () => {
        expect(pickProblem(t1, { tables: floor })).toBeNull();
        expect(pickProblem(t5, { tables: floor, pickedIds: ['t5'] })).toBeNull();
    });

    it('blocks the picks the API would refuse, and says why', () => {
        // Una mesa de otra sucursal no entra ni en el grupo elegido ni en uno nuevo.
        expect(pickProblem(t6, { tables: floor, pickedGroup: joined })).toBe('La mesa 6 es de otra sucursal');
        expect(pickProblem(t6, { tables: floor, pickedIds: ['t5'] })).toBe('La mesa 6 es de otra sucursal');
        // Ni una visita en curso, ni una mesa fuera de servicio.
        const visiting = table('t7', 7, { status: 'ocupada', active_attention_id: 'visit-t7' });
        expect(pickProblem(visiting, { tables: [...floor, visiting] }))
            .toBe('La mesa 7 tiene una visita en curso');
        const reserved = table('t8', 8, { status: 'reservada' });
        expect(pickProblem(reserved, { tables: [...floor, reserved] }))
            .toBe('La mesa 8 no está disponible para unir');
    });

    it('blocks a second group while one is already chosen', () => {
        expect(pickProblem(t4, { tables: twoGroups, pickedGroup: joined }))
            .toMatch(/ya está elegido/);
    });

    it('mirrors the ceiling of the group', () => {
        const members = Array.from({ length: 12 }, (_, i) => table(`x${i}`, 20 + i, { status: 'ocupada' }));
        const big = group(members.map((t) => t.id), { id: 'group-3', name: null, anchor_table_id: 'x0' });
        const withBig = [...members.map((t) => ({ ...t, group: big })), table('t9', 9)];
        expect(pickProblem(withBig[12], { tables: withBig, pickedGroup: big }))
            .toBe('Un grupo admite hasta 12 mesas');
        // Y un grupo que ya está al tope tampoco se deja elegir.
        expect(pickProblem(withBig[0], { tables: withBig }))
            .toBe('Este grupo ya tiene 12 mesas');
    });

    it('derives a new group, an extension, or neither', () => {
        const free = [table('t1', 1), table('t2', 2)];
        const fresh = joinOperation({ tables: free, activeOrders: {}, pickedIds: ['t1', 't2'] });
        expect(fresh.kind).toBe('create');
        expect(fresh.canConfirm).toBe(true);
        expect(fresh.issue).toBeNull();

        // Una sola mesa todavía no es nada, y eso es guía, no error.
        const one = joinOperation({ tables: free, activeOrders: {}, pickedIds: ['t1'] });
        expect(one.kind).toBe('create');
        expect(one.canConfirm).toBe(false);
        expect(one.issue).toBeNull();

        const growing = joinOperation({
            tables: floor, activeOrders: {}, pickedIds: ['t5'], pickedGroupIds: ['group-1'],
        });
        expect(growing.kind).toBe('extend');
        expect(growing.group.id).toBe('group-1');
        expect(growing.canConfirm).toBe(true);

        // El grupo solo, sin mesa que sumarle, no es una operación.
        const alone = joinOperation({ tables: floor, activeOrders: {}, pickedIds: [], pickedGroupIds: ['group-1'] });
        expect(alone.kind).toBe('extend');
        expect(alone.canConfirm).toBe(false);
        expect(alone.issue).toBeNull();

        const both = joinOperation({
            tables: twoGroups, activeOrders: {}, pickedIds: [], pickedGroupIds: ['group-1', 'group-2'],
        });
        expect(both.canConfirm).toBe(false);
        expect(both.issue).toBe('Solo se puede ampliar un grupo a la vez');
    });

    it('refuses the tables the group endpoint would refuse', () => {
        expect(extendProblem(joined, floor, {}, ['t5'])).toBeNull();
        expect(extendProblem(joined, floor, {}, [])).toMatch(/al menos una mesa/);
        expect(extendProblem(joined, floor, {}, ['t6'])).toBe('La mesa 6 es de otra sucursal');
        expect(extendProblem(null, floor, {}, ['t5'])).toMatch(/Elige un grupo/);
    });

    it('only lets an account owner be the principal table', () => {
        const mixed = [table('t1', 1), table('t2', 2), table('t3', 3)];
        const accounts = {
            t2: visit('t2', { created_at: '2026-01-01T09:00:00Z' }),
            t3: visit('t3', { created_at: '2026-01-01T10:00:00Z' }),
        };
        // Con cuentas abiertas, la mesa libre no puede nombrar al grupo.
        expect(anchorCandidates(mixed, accounts, ['t1', 't2', 't3']).map((t) => t.id)).toEqual(['t2', 't3']);
        // Sin cuentas, la de menor número.
        expect(anchorCandidates(mixed, {}, ['t1', 't3']).map((t) => t.id)).toEqual(['t1', 't3']);

        const candidates = anchorCandidates(mixed, accounts, ['t1', 't2', 't3']);
        expect(resolveAnchor(['t1', 't2', 't3'], candidates, null)).toBe('t2');
        expect(resolveAnchor(['t1', 't2', 't3'], candidates, 't3')).toBe('t3');
        // Una principal que se dejó de elegir cae a la que decide el servidor.
        const free = anchorCandidates(mixed, {}, ['t1', 't3']);
        expect(resolveAnchor(['t1', 't3'], free, 't2')).toBe('t1');
    });

    it('tells the mozo what the next tap is for', () => {
        const free = [table('t1', 1), table('t2', 2)];
        expect(selectionGuidance({
            operation: { kind: 'create', group: null }, pickedIds: [], tables: free,
        })).toBe('Elige dos o más mesas para unirlas');
        // La instrucción sobrevive al primer toque: es cuando falta una más.
        expect(selectionGuidance({
            operation: { kind: 'create', group: null }, pickedIds: ['t1'], tables: free,
        })).toBe('Elige al menos una mesa más');
        expect(selectionGuidance({
            operation: { kind: 'extend', group: joined }, pickedIds: [], tables: free,
        })).toBe('Elige las mesas que se suman a Mesas 1 + 2');
        expect(selectionGuidance({
            operation: { kind: 'extend', group: joined }, pickedIds: ['t5'], tables: free,
        })).toBe('1 mesa se suma a Mesas 1 + 2');
        // Dos grupos elegidos: la guía no puede hablar de un grupo que no hay.
        // El aviso de la barra es el que explica el problema.
        expect(selectionGuidance({
            operation: { kind: 'extend', group: null }, pickedIds: ['t5'], tables: free,
        })).toBe('1 mesa se suma');
        expect(selectionGuidance({
            operation: { kind: 'extend', group: null }, pickedIds: [], tables: free,
        })).toBe('Elige las mesas que se suman');
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
