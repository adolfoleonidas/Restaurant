import { act } from 'react';
import { toast } from 'sonner';
import useFloorActions from '@/pages/salon/useFloorActions';
import { closeOrderAttention, serveOrder, setOrderStatus } from '@/lib/api/orders';
import { releaseTable } from '@/lib/api/tables';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({
    closeOrderAttention: jest.fn(), serveOrder: jest.fn(), setOrderStatus: jest.fn(),
}));
jest.mock('@/lib/api/tables', () => ({ releaseTable: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const closeSheet = jest.fn();
const refreshAll = jest.fn();
const refetchTables = jest.fn();
const navigate = jest.fn();
let mounted;

const mount = async (canTake = true) => {
    mounted = await renderHook((p) => useFloorActions(p), {
        canTake, closeSheet, refreshAll, refetchTables, navigate,
    });
    return mounted.result;
};

beforeEach(() => {
    [closeOrderAttention, serveOrder, setOrderStatus, releaseTable].forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
    [closeSheet, refreshAll, refetchTables, navigate].forEach((fn) => fn.mockReset());
    Object.values(toast).forEach((fn) => fn.mockReset());
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useFloorActions', () => {
    test('deliver serves the order, closes the sheet and refreshes', async () => {
        const result = await mount();
        await act(async () => { await result.current.deliver('o1'); });
        expect(serveOrder).toHaveBeenCalledWith('o1');
        expect(toast.success).toHaveBeenCalledWith('Pedido entregado');
        expect(closeSheet).toHaveBeenCalled();
        expect(refreshAll).toHaveBeenCalled();
    });

    test('deliver reports the server detail on failure', async () => {
        serveOrder.mockRejectedValue({ response: { data: { detail: 'Ya entregado' } } });
        const result = await mount();
        await act(async () => { await result.current.deliver('o1'); });
        expect(toast.error).toHaveBeenCalledWith('Ya entregado');
        expect(closeSheet).not.toHaveBeenCalled();
    });

    test('closing the attention marks the order while it runs and refreshes even on failure', async () => {
        let resolve;
        closeOrderAttention.mockReturnValue(new Promise((r) => { resolve = r; }));
        const result = await mount();
        let pending;
        act(() => { pending = result.current.closeAttention({ id: 'o1' }); });
        expect(result.current.closing).toBe('o1');
        await act(async () => { resolve({ data: {} }); await pending; });
        expect(closeOrderAttention).toHaveBeenCalledWith('o1');
        expect(toast.success).toHaveBeenCalledWith('Atención cerrada');
        expect(result.current.closing).toBeNull();

        closeOrderAttention.mockRejectedValue({});
        await act(async () => { await result.current.closeAttention({ id: 'o2' }); });
        expect(toast.error).toHaveBeenCalledWith('No se pudo cerrar la atención. Puedes reintentar.');
        expect(refreshAll).toHaveBeenCalledTimes(2);
        expect(result.current.closing).toBeNull();
    });

    test('requestBill moves the order to pending payment', async () => {
        const result = await mount();
        await act(async () => { await result.current.requestBill({ id: 'o1' }); });
        expect(setOrderStatus).toHaveBeenCalledWith('o1', { status: 'pendiente_pago' });
        expect(toast.success).toHaveBeenCalledWith('Cuenta solicitada');
    });

    test('releaseTable frees a paid table only for roles that can take tables', async () => {
        const result = await mount();
        await act(async () => { await result.current.releaseTable({ id: 't1', number: 4 }); });
        expect(releaseTable).toHaveBeenCalledWith('t1');
        expect(toast.success).toHaveBeenCalledWith('Mesa 4 libre');
        expect(refetchTables).toHaveBeenCalled();
        expect(closeSheet).toHaveBeenCalled();
        await mounted.unmount();

        releaseTable.mockClear();
        const readOnly = await mount(false);
        await act(async () => { await readOnly.current.releaseTable({ id: 't1', number: 4 }); });
        expect(releaseTable).not.toHaveBeenCalled();
    });

    test('charging leaves the floor for the order screen', async () => {
        const result = await mount();
        act(() => result.current.openCharge({ id: 'o9' }));
        expect(closeSheet).toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith('/pedidos/o9');
    });
});
