import { act } from 'react';
import { toast } from 'sonner';
import useFloorActions, { servedOrderPatch } from '@/pages/salon/useFloorActions';
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
const patchOrder = jest.fn();
let mounted;

const mount = async (canTake = true, overrides = {}) => {
    mounted = await renderHook((p) => useFloorActions(p), {
        canTake, closeSheet, refreshAll, refetchTables, navigate, patchOrder, ...overrides,
    });
    return mounted.result;
};

beforeEach(() => {
    [closeOrderAttention, serveOrder, setOrderStatus, releaseTable].forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }));
    [closeSheet, refreshAll, refetchTables, navigate, patchOrder].forEach((fn) => fn.mockReset());
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

    test('deliver pinta la tarjeta ANTES de que el servidor conteste', async () => {
        // Entregar son dos viajes (el POST y el refresco): sin pintar al toque, la
        // tarjeta quedaba igual más de un segundo y el mozo creía que no funcionaba.
        let resolveServe;
        serveOrder.mockReturnValue(new Promise((r) => { resolveServe = r; }));
        const result = await mount();

        let running;
        await act(async () => { running = result.current.deliver('o1'); });
        expect(patchOrder).toHaveBeenCalledTimes(1);
        const [patchedId, change] = patchOrder.mock.calls[0];
        expect(patchedId).toBe('o1');
        const order = { id: 'o1', items: [{ id: 'i1', status: 'listo' }, { id: 'i2', status: 'en_preparacion' }] };
        expect(change(order).items.map((i) => i.status)).toEqual(['entregado', 'en_preparacion']);

        await act(async () => { resolveServe({ data: {} }); await running; });
    });

    test('el parche de entregar refleja el estado, no solo los platos', () => {
        // El servidor deja el pedido en «entregado» (`ticket_fields`). Si el
        // parche solo moviera los platos, la tarjeta seguiría diciendo «Listo»
        // hasta el siguiente sondeo: «no cambia hasta que abro el pedido».
        const order = {
            id: 'o1', status: 'listo', total: 45, amount_paid: 0, payment_status: 'pendiente',
            items: [{ id: 'i1', status: 'listo' }, { id: 'i2', status: 'en_preparacion' }],
        };
        expect(servedOrderPatch(order)).toEqual({
            items: [{ id: 'i1', status: 'entregado' }, { id: 'i2', status: 'en_preparacion' }],
            fulfillment_status: 'entregado',
            status: 'entregado',
        });
    });

    test('una cuenta ya cobrada pasa a «pagada» al servir, como en el servidor', () => {
        const order = {
            id: 'o1', status: 'listo', total: 45, amount_paid: 45, payment_status: 'pagado',
            items: [{ id: 'i1', status: 'listo' }],
        };
        expect(servedOrderPatch(order).status).toBe('pagado');
        // Un pago parcial no cierra la cuenta, y un pedido sin platos tampoco rompe.
        expect(servedOrderPatch({ ...order, amount_paid: 20, payment_status: 'parcial' }).status).toBe('entregado');
        expect(servedOrderPatch({}).items).toEqual([]);
    });

    test('si el servidor falla, lo pintado se descarta y vuelve la verdad', async () => {
        serveOrder.mockRejectedValue({ response: { data: { detail: 'Ya entregado' } } });
        const result = await mount();
        await act(async () => { await result.current.deliver('o1'); });

        expect(patchOrder).toHaveBeenCalledTimes(1);
        // Dos veces: una al fallar y otra al terminar la acción.
        expect(refreshAll).toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Ya entregado');
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

    test('charging hands the account to the cash screen, not to the order taker', async () => {
        const result = await mount(true, { canUseCaja: true });
        act(() => result.current.openCharge({ id: 'o9' }));
        expect(closeSheet).toHaveBeenCalled();
        // La caja acepta la cuenta por `?order=`: es el único destino que cobra.
        expect(navigate).toHaveBeenCalledWith('/caja?order=o9');
        expect(navigate).not.toHaveBeenCalledWith('/pedidos/o9');
    });

    test('without access to the cash screen the order detail still knows how to charge', async () => {
        const result = await mount(true, { canUseCaja: false });
        act(() => result.current.openCharge({ id: 'o9' }));
        expect(navigate).toHaveBeenCalledWith('/pedidos/o9');
    });
    test.each([
        ['deliver', 'deliver:o1', (r) => r.current.deliver('o1'), serveOrder],
        ['requestBill', 'bill:o1', (r) => r.current.requestBill({ id: 'o1' }), setOrderStatus],
        ['releaseTable', 'release:t1', (r) => r.current.releaseTable({ id: 't1', number: 4 }), releaseTable],
    ])('%s ignores repeat taps while pending and exposes its pending key', async (name, key, call, api) => {
        let resolve;
        api.mockReturnValue(new Promise((r) => { resolve = r; }));
        const result = await mount();
        let first;
        act(() => { first = call(result); });
        act(() => { call(result); call(result); });
        expect(api).toHaveBeenCalledTimes(1);
        expect(result.current.pending.has(key)).toBe(true);
        await act(async () => { resolve({ data: {} }); await first; });
        expect(result.current.pending.has(key)).toBe(false);
    });

    test('closeAttention ignores repeat taps while pending', async () => {
        let resolve;
        closeOrderAttention.mockReturnValue(new Promise((r) => { resolve = r; }));
        const result = await mount();
        let first;
        act(() => { first = result.current.closeAttention({ id: 'o1' }); });
        act(() => { result.current.closeAttention({ id: 'o1' }); });
        expect(closeOrderAttention).toHaveBeenCalledTimes(1);
        await act(async () => { resolve({ data: {} }); await first; });
    });
});
