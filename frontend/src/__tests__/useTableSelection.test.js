import { act } from 'react';
import { toast } from 'sonner';
import useTableSelection from '@/pages/salon/useTableSelection';
import {
    addTableGroupMember, createTableGroup, deleteTableGroup, removeTableGroupMember,
} from '@/lib/api/tables';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/tables', () => ({
    createTableGroup: jest.fn(),
    deleteTableGroup: jest.fn(),
    addTableGroupMember: jest.fn(),
    removeTableGroupMember: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4, status: 'disponible', branch_id: 'b1',
    active_order: null, active_attention_id: null, group: null, ...extra,
});

const closeSheet = jest.fn();
const refreshAll = jest.fn();
let mounted;

const mount = async (tables, activeOrders = {}) => {
    mounted = await renderHook((p) => useTableSelection(p), {
        tables, activeOrders, refreshAll, closeSheet,
    });
    return mounted.result;
};

beforeEach(() => {
    [createTableGroup, deleteTableGroup, addTableGroupMember, removeTableGroupMember]
        .forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
    [closeSheet, refreshAll].forEach((fn) => fn.mockReset());
    Object.values(toast).forEach((fn) => fn.mockReset());
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useTableSelection', () => {
    const tables = [table('t1', 1), table('t2', 2), table('t3', 3, { branch_id: 'b2' })];

    test('starting a selection clears the previous one and toggling adds and removes tables', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        expect(result.current.selectMode).toBe(true);
        expect(result.current.selected).toEqual([]);

        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        expect(result.current.selected).toEqual(['t1', 't2']);
        act(() => result.current.toggleSelected(tables[0]));
        expect(result.current.selected).toEqual(['t2']);

        act(() => result.current.cancelSelection());
        expect(result.current.selectMode).toBe(false);
        expect(result.current.selected).toEqual([]);
    });

    test('explains why a selection cannot be joined', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        expect(result.current.selectionIssue).toBeNull();
        expect(result.current.canConfirmJoin).toBe(false);

        act(() => result.current.toggleSelected(tables[2]));
        expect(result.current.selectionIssue).toBe('Las mesas deben pertenecer a la misma sucursal');
        expect(result.current.canConfirmJoin).toBe(false);

        act(() => result.current.toggleSelected(tables[2]));
        act(() => result.current.toggleSelected(tables[1]));
        expect(result.current.selectionIssue).toBeNull();
        expect(result.current.canConfirmJoin).toBe(true);
    });

    test('joins the selected tables, offers an undo and leaves selection mode', async () => {
        createTableGroup.mockResolvedValue({ data: { id: 'g1' } });
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        await act(async () => { await result.current.joinTables(); });

        expect(createTableGroup).toHaveBeenCalledWith({ table_ids: ['t1', 't2'] });
        expect(toast.success).toHaveBeenCalledWith('Mesas unidas', expect.objectContaining({ duration: 8000 }));
        expect(result.current.selectMode).toBe(false);
        expect(result.current.joining).toBe(false);
        expect(refreshAll).toHaveBeenCalled();

        const { action } = toast.success.mock.calls[0][1];
        expect(action.label).toBe('Deshacer');
        await act(async () => { await action.onClick(); });
        expect(deleteTableGroup).toHaveBeenCalledWith('g1');
        expect(toast.success).toHaveBeenCalledWith('Mesas separadas');
    });

    test('without a group id the join cannot be undone and promises nothing', async () => {
        createTableGroup.mockResolvedValue({ data: {} });
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        await act(async () => { await result.current.joinTables(); });
        expect(toast.success).toHaveBeenCalledWith('Mesas unidas');
    });

    test('a failed join shows the detail and refreshes the floor', async () => {
        createTableGroup.mockRejectedValue({ response: { data: { detail: 'Mesa ocupada' } } });
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        await act(async () => { await result.current.joinTables(); });
        expect(toast.error).toHaveBeenCalledWith('Mesa ocupada');
        expect(refreshAll).toHaveBeenCalled();
        expect(result.current.selectMode).toBe(true);
        expect(result.current.joining).toBe(false);
    });

    test('does nothing when the selection is not joinable', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        await act(async () => { await result.current.joinTables(); });
        expect(createTableGroup).not.toHaveBeenCalled();
    });

    test('dissolves a group or separates one member and closes the sheet', async () => {
        const result = await mount(tables);
        await act(async () => { await result.current.dissolveGroup({ id: 'g1' }); });
        expect(deleteTableGroup).toHaveBeenCalledWith('g1');
        expect(toast.success).toHaveBeenCalledWith('Mesas separadas');
        expect(closeSheet).toHaveBeenCalledTimes(1);

        await act(async () => { await result.current.removeGroupMember({ id: 'g1' }, { id: 't2', number: 2 }); });
        expect(removeTableGroupMember).toHaveBeenCalledWith('g1', 't2');
        expect(toast.success).toHaveBeenCalledWith('Mesa 2 separada');
        expect(closeSheet).toHaveBeenCalledTimes(2);

        await act(async () => { await result.current.dissolveGroup(null); });
        expect(deleteTableGroup).toHaveBeenCalledTimes(1);
    });

    test('Escape leaves selection mode', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        expect(result.current.selectMode).toBe(false);
    });

    describe('growing a group that is already joined', () => {
        const joined = { id: 'g1', name: null, anchor_table_id: 't1', table_ids: ['t1', 't2'] };
        const grouped = [
            table('t1', 1, { status: 'ocupada', group: joined, active_attention_id: 'visit-t1' }),
            table('t2', 2, { status: 'ocupada', group: joined }),
            table('t5', 5),
        ];

        test('picking a joined table picks the whole group, and it means "add to it"', async () => {
            const result = await mount(grouped);
            act(() => result.current.startSelection());
            act(() => result.current.toggleSelected(grouped[1]));

            // El grupo entero es la elección, no una silla de la mesa 2.
            expect(result.current.selected).toEqual([]);
            expect(result.current.pickedGroupIds).toEqual(['g1']);
            expect(result.current.operation.kind).toBe('extend');
            // Elegir un grupo sin mesa que sumarle todavía no es una operación.
            expect(result.current.canConfirmJoin).toBe(false);
            expect(result.current.guidance).toMatch(/se suman a Mesas 1 \+ 2/);

            act(() => result.current.toggleSelected(grouped[2]));
            expect(result.current.canConfirmJoin).toBe(true);
            expect(result.current.guidance).toMatch(/1 mesa se suma a Mesas 1 \+ 2/);
            // La capacidad que el grupo va a tener: 4 + 4 + 4.
            expect(result.current.seats).toBe(12);
        });

        test('adds each table through the group endpoint and undoes it member by member', async () => {
            const result = await mount(grouped);
            act(() => result.current.startSelection());
            act(() => result.current.toggleSelected(grouped[1]));
            act(() => result.current.toggleSelected(grouped[2]));
            await act(async () => { await result.current.joinTables(); });

            // Un grupo unido se amplía sin disolverlo ni volver a unir sus mesas.
            expect(addTableGroupMember).toHaveBeenCalledWith('g1', 't5');
            expect(createTableGroup).not.toHaveBeenCalled();
            expect(deleteTableGroup).not.toHaveBeenCalled();
            expect(toast.success).toHaveBeenCalledWith('Mesa 5 sumada al grupo', expect.objectContaining({ duration: 8000 }));
            expect(result.current.selectMode).toBe(false);
            expect(refreshAll).toHaveBeenCalled();

            const { action } = toast.success.mock.calls[0][1];
            expect(action.label).toBe('Deshacer');
            await act(async () => { await action.onClick(); });
            expect(removeTableGroupMember).toHaveBeenCalledWith('g1', 't5');
        });

        test('refuses a table that cannot join the group, and says which one', async () => {
            const withVisit = [
                ...grouped,
                table('t6', 6, { status: 'ocupada', active_attention_id: 'visit-t6' }),
            ];
            const result = await mount(withVisit);
            act(() => result.current.startSelection());
            act(() => result.current.toggleSelected(withVisit[1]));
            // La tarjeta bloquea el toque, pero la barra también sabe explicarlo
            // si la mesa cambió de estado después de elegirla.
            expect(result.current.pickIssues.t6).toMatch(/visita en curso/);
            act(() => result.current.toggleSelected(withVisit[3]));
            expect(result.current.selectionIssue).toBe('La mesa 6 tiene una visita en curso');
            expect(result.current.canConfirmJoin).toBe(false);
        });
    });

    test('re-reads a pick that went stale and blocks the confirm', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        expect(result.current.canConfirmJoin).toBe(true);

        // El piso se refresca: la mesa 2 pasa a tener una visita en curso que
        // nadie pidió desde esta pantalla.
        await mounted.rerender({
            tables: [
                tables[0],
                table('t2', 2, { status: 'ocupada', active_attention_id: 'visit-t2' }),
                tables[2],
            ],
            activeOrders: {}, refreshAll, closeSheet,
        });

        expect(result.current.selectionIssue).toBe('La mesa 2 tiene una visita en curso');
        expect(result.current.canConfirmJoin).toBe(false);
    });

    test('unpicking a chip drops that table without cancelling the selection', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        act(() => result.current.unpick('t1'));

        expect(result.current.selected).toEqual(['t2']);
        expect(result.current.canConfirmJoin).toBe(false);
        expect(result.current.selectMode).toBe(true);
    });

    test('offers the principal table only when there is a choice, and sends it', async () => {
        const owned = [
            table('t1', 1, { active_order: { id: 'o1', created_at: '2026-01-01T10:00:00Z' } }),
            table('t2', 2, { active_order: { id: 'o2', created_at: '2026-01-01T09:00:00Z' } }),
            table('t3', 3),
        ];
        const result = await mount(owned, {
            t1: { id: 'o1', created_at: '2026-01-01T10:00:00Z', status: 'en_preparacion' },
            t2: { id: 'o2', created_at: '2026-01-01T09:00:00Z', status: 'en_preparacion' },
        });
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(owned[0]));
        act(() => result.current.toggleSelected(owned[1]));
        act(() => result.current.toggleSelected(owned[2]));

        // Con cuentas abiertas, la principal tiene que ser una de ellas: la mesa
        // libre no puede nombrar al grupo.
        expect(result.current.anchorCandidates.map((t) => t.id)).toEqual(['t2', 't1']);
        // Por defecto se manda la que el servidor ya habría elegido (la cuenta
        // más antigua), así que no viaja ningún campo de más.
        expect(result.current.anchorId).toBe('t2');
        act(() => result.current.chooseAnchor('t1'));
        expect(result.current.anchorId).toBe('t1');
        await act(async () => { await result.current.joinTables(); });
        expect(createTableGroup).toHaveBeenCalledWith({ table_ids: ['t1', 't2', 't3'], anchor_table_id: 't1' });
    });

    test('leaves the principal table out of the request while the API default is the right one', async () => {
        const result = await mount(tables);
        act(() => result.current.startSelection());
        act(() => result.current.toggleSelected(tables[0]));
        act(() => result.current.toggleSelected(tables[1]));
        await act(async () => { await result.current.joinTables(); });
        // Sin cuentas abiertas la principal es la de menor número: mandarla
        // sería repetir lo que el servidor ya hace solo.
        expect(createTableGroup).toHaveBeenCalledWith({ table_ids: ['t1', 't2'] });
    });

    test('confirms separating a group from the floor and refreshes', async () => {
        const result = await mount(tables);
        act(() => result.current.askSeparateGroup({ id: 'g1' }));
        expect(result.current.separateGroup).toEqual({ id: 'g1' });

        await act(async () => { await result.current.confirmSeparateGroup(); });
        expect(deleteTableGroup).toHaveBeenCalledWith('g1');
        expect(result.current.separateGroup).toBeNull();
        expect(result.current.separating).toBeNull();
        expect(refreshAll).toHaveBeenCalled();
    });
});
