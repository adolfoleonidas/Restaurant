import { act } from 'react';
import { toast } from 'sonner';
import useVisitTransfer from '@/pages/salon/useVisitTransfer';
import { transferTable } from '@/lib/api/tables';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/tables', () => ({ transferTable: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', status: 'disponible', branch_id: 'b1',
    active_order: null, active_attention_id: null, group: null, ...extra,
});

const busy = table('t1', 1, { status: 'ocupada', active_order: { id: 'o1' } });
const free = table('t2', 2);
const closeSheet = jest.fn();
const refreshAll = jest.fn();
let mounted;

const mount = async () => {
    mounted = await renderHook((p) => useVisitTransfer(p), {
        tables: [busy, free, table('t3', 3, { branch_id: 'b2' })],
        activeOrders: { t1: { id: 'o1' } },
        closeSheet,
        refreshAll,
    });
    return mounted.result;
};

beforeEach(() => {
    transferTable.mockReset().mockResolvedValue({ data: { to_number: 2 } });
    [closeSheet, refreshAll].forEach((fn) => fn.mockReset());
    Object.values(toast).forEach((fn) => fn.mockReset());
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useVisitTransfer', () => {
    test('opening the transfer closes the sheet and lists the free tables of the same branch', async () => {
        const result = await mount();
        act(() => result.current.openTransfer(busy));
        expect(closeSheet).toHaveBeenCalled();
        expect(result.current.transferSource).toBe(busy);
        expect(result.current.transferTargets.map((t) => t.id)).toEqual(['t2']);
    });

    test('a table without an active order cannot be moved and says why', async () => {
        const result = await mount();
        act(() => result.current.openTransfer(free));
        expect(toast.info).toHaveBeenCalledWith('La mesa no tiene un pedido activo para mover');
        expect(result.current.transferSource).toBeNull();
        expect(closeSheet).not.toHaveBeenCalled();
    });

    test('moves the visit to the chosen table and closes the dialog', async () => {
        const result = await mount();
        act(() => result.current.openTransfer(busy));
        await act(async () => { await result.current.moveVisit(free); });
        expect(transferTable).toHaveBeenCalledWith('t1', { target_table_id: 't2' });
        expect(toast.success).toHaveBeenCalledWith('Pedido movido a Mesa 2');
        expect(result.current.transferSource).toBeNull();
        expect(result.current.movingVisit).toBe(false);
        expect(refreshAll).toHaveBeenCalled();
    });

    test('a failed move keeps the dialog open, reports the detail and refreshes', async () => {
        transferTable.mockRejectedValue({ response: { data: { detail: 'Mesa tomada' } } });
        const result = await mount();
        act(() => result.current.openTransfer(busy));
        await act(async () => { await result.current.moveVisit(free); });
        expect(toast.error).toHaveBeenCalledWith('Mesa tomada');
        expect(result.current.transferSource).toBe(busy);
        expect(result.current.movingVisit).toBe(false);
        expect(refreshAll).toHaveBeenCalled();
    });

    test('moveVisit without an open transfer does nothing', async () => {
        const result = await mount();
        await act(async () => { await result.current.moveVisit(free); });
        expect(transferTable).not.toHaveBeenCalled();
    });
});
