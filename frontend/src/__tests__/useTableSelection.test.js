import { act } from 'react';
import { toast } from 'sonner';
import useTableSelection from '@/pages/salon/useTableSelection';
import { createTableGroup, deleteTableGroup, removeTableGroupMember } from '@/lib/api/tables';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/tables', () => ({
    createTableGroup: jest.fn(),
    deleteTableGroup: jest.fn(),
    removeTableGroupMember: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', status: 'disponible', branch_id: 'b1',
    active_order: null, active_attention_id: null, group: null, ...extra,
});

const closeSheet = jest.fn();
const refreshAll = jest.fn();
let mounted;

const mount = async (tables) => {
    mounted = await renderHook((p) => useTableSelection(p), {
        tables, activeOrders: {}, refreshAll, closeSheet,
    });
    return mounted.result;
};

beforeEach(() => {
    [createTableGroup, deleteTableGroup, removeTableGroupMember].forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
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
});
