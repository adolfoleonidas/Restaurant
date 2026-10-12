import { act } from 'react';
import { toast } from 'sonner';
import useOrderProof from '@/hooks/useOrderProof';
import { getOrder } from '@/lib/api/orders';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({ getOrder: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let mounted;
const mount = async (scopeParams) => {
    mounted = await renderHook((p) => useOrderProof(p), scopeParams);
    return mounted.result;
};

beforeEach(() => {
    getOrder.mockReset().mockResolvedValue({ data: { id: 'o1', payment_proof_url: 'data:image/png;base64,AAA' } });
    toast.error.mockReset();
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useOrderProof', () => {
    test('loads the proof image of an order', async () => {
        const result = await mount();
        expect(result.current.proof).toBeNull();
        await act(async () => { await result.current.openProof({ id: 'o1', order_number: 7 }); });
        expect(getOrder.mock.calls[0][0]).toBe('o1');
        expect(getOrder.mock.calls[0][1]).toBeUndefined();
        expect(result.current.proof).toEqual({ order: { id: 'o1', order_number: 7 }, url: 'data:image/png;base64,AAA' });
        expect(result.current.loading).toBe(false);
    });

    test('asks for the account inside the chosen branch scope', async () => {
        const result = await mount({ branch_id: 'b1' });
        await act(async () => { await result.current.openProof({ id: 'o1' }); });
        expect(getOrder).toHaveBeenCalledWith('o1', { params: { branch_id: 'b1' } });
    });

    test('an empty scope sends no params at all', async () => {
        const result = await mount({});
        await act(async () => { await result.current.openProof({ id: 'o1' }); });
        expect(getOrder.mock.calls[0][1]).toBeUndefined();
    });

    test('an order without an image still opens, with no url', async () => {
        getOrder.mockResolvedValue({ data: { id: 'o1' } });
        const result = await mount();
        await act(async () => { await result.current.openProof({ id: 'o1' }); });
        expect(result.current.proof.url).toBeNull();
    });

    test('shows loading while the request runs', async () => {
        let resolve;
        getOrder.mockReturnValue(new Promise((r) => { resolve = r; }));
        const result = await mount();
        let pending;
        act(() => { pending = result.current.openProof({ id: 'o1' }); });
        expect(result.current.loading).toBe(true);
        await act(async () => { resolve({ data: { id: 'o1' } }); await pending; });
        expect(result.current.loading).toBe(false);
    });

    test('a failed request tells the cashier and keeps nothing open', async () => {
        getOrder.mockRejectedValue(new Error('x'));
        const result = await mount();
        await act(async () => { await result.current.openProof({ id: 'o1' }); });
        expect(toast.error).toHaveBeenCalledWith('No se pudo cargar el comprobante');
        expect(result.current.proof).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    test('closeProof hides the image', async () => {
        const result = await mount();
        await act(async () => { await result.current.openProof({ id: 'o1' }); });
        act(() => result.current.closeProof());
        expect(result.current.proof).toBeNull();
    });
});
