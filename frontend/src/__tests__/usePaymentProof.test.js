import { act } from 'react';
import usePaymentProof from '@/hooks/usePaymentProof';
import { getOrder } from '@/lib/api/orders';
import { getCollectionConfig, uploadPaymentProof } from '@/lib/api/payments';
import { renderHook, flush } from '@/test-utils/renderHook';

jest.mock('@/lib/api/orders', () => ({ getOrder: jest.fn() }));
jest.mock('@/lib/api/payments', () => ({ getCollectionConfig: jest.fn(), uploadPaymentProof: jest.fn() }));

const acct = { id: 'o1', payment_status: 'pendiente' };
const config = { yape: { enabled: true, number: '999' }, plin: { enabled: false } };
const onOrderRefreshed = jest.fn();
let mounted;

const mount = async (props = {}) => {
    mounted = await renderHook((p) => usePaymentProof(p), {
        open: true, canSubmitProof: true, restaurantId: 'r1', acct, backendMethod: 'yape', onOrderRefreshed, ...props,
    });
    await flush();
    return mounted;
};

beforeEach(() => {
    getCollectionConfig.mockReset().mockResolvedValue({ data: config });
    uploadPaymentProof.mockReset().mockResolvedValue({ data: {} });
    getOrder.mockReset().mockResolvedValue({ data: { id: 'o1', payment_status: 'comprobante_subido' } });
    onOrderRefreshed.mockReset();
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('usePaymentProof: collection config', () => {
    test('loads the receiving accounts while the dialog is open for a user who can send proofs', async () => {
        const { result } = await mount();
        expect(getCollectionConfig).toHaveBeenCalledTimes(1);
        expect(result.current.collectionConfig).toEqual(config);
        expect(result.current.collectionConfigError).toBe(false);
    });

    test('does not load them when closed or when the user cannot send proofs', async () => {
        await mount({ open: false });
        expect(getCollectionConfig).not.toHaveBeenCalled();
        await mounted.unmount();
        await mount({ canSubmitProof: false });
        expect(getCollectionConfig).not.toHaveBeenCalled();
    });

    test('flags a failed load', async () => {
        getCollectionConfig.mockRejectedValue(new Error('x'));
        const { result } = await mount();
        expect(result.current.collectionConfig).toBeNull();
        expect(result.current.collectionConfigError).toBe(true);
    });
});

describe('usePaymentProof: sending a proof', () => {
    test('uploads the image with its method, then refreshes the account', async () => {
        const { result } = await mount();
        act(() => result.current.setSelectedProof('data:image/png;base64,AAA'));
        await act(async () => { await result.current.submitProof(); });
        expect(uploadPaymentProof).toHaveBeenCalledWith('o1', { method: 'yape', payment_proof: 'data:image/png;base64,AAA' });
        expect(result.current.proofSent).toBe(true);
        expect(result.current.proofSending).toBe(false);
        expect(getOrder).toHaveBeenCalledWith('o1');
        expect(onOrderRefreshed).toHaveBeenCalledWith({ id: 'o1', payment_status: 'comprobante_subido' });
        expect(result.current.proofRefreshPending).toBe(false);
    });

    test('does nothing without an image or for a method that is not enabled', async () => {
        const { result } = await mount();
        await act(async () => { await result.current.submitProof(); });
        expect(uploadPaymentProof).not.toHaveBeenCalled();

        await mounted.rerender({
            open: true, canSubmitProof: true, restaurantId: 'r1', acct, backendMethod: 'plin', onOrderRefreshed,
        });
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        expect(uploadPaymentProof).not.toHaveBeenCalled();
    });

    test('a failed upload keeps the image and the method so the same send can be retried', async () => {
        uploadPaymentProof.mockRejectedValueOnce({ response: { data: { detail: 'Imagen muy grande' } } });
        const { result } = await mount();
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        expect(result.current.proofError).toBe('Imagen muy grande');
        expect(result.current.proofIntent).toEqual({ orderId: 'o1', method: 'yape', payment_proof: 'img' });
        expect(result.current.proofSent).toBe(false);

        await act(async () => { await result.current.submitProof(); });
        expect(uploadPaymentProof).toHaveBeenLastCalledWith('o1', { method: 'yape', payment_proof: 'img' });
        expect(result.current.proofSent).toBe(true);
        expect(result.current.proofError).toBe('');
    });

    test('a non-text error falls back to the generic message', async () => {
        uploadPaymentProof.mockRejectedValueOnce({});
        const { result } = await mount();
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        expect(result.current.proofError).toBe('No se pudo enviar el comprobante. Puede reintentar la misma imagen.');
    });

    test('when the account cannot be refreshed the cashier is told to reload before charging', async () => {
        getOrder.mockRejectedValueOnce(new Error('offline'));
        const { result } = await mount();
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        expect(result.current.proofSent).toBe(true);
        expect(result.current.proofRefreshPending).toBe(true);
        expect(result.current.proofRefreshError).toBe('El comprobante fue recibido, pero no se pudo actualizar la cuenta. Recargue antes de registrar un pago.');

        await act(async () => { await result.current.retryOrderRefresh(); });
        expect(result.current.proofRefreshPending).toBe(false);
        expect(result.current.proofRefreshError).toBe('');
        expect(onOrderRefreshed).toHaveBeenCalledTimes(1);
    });

    test('a response for another account is not accepted', async () => {
        getOrder.mockResolvedValueOnce({ data: { id: 'other' } });
        const { result } = await mount();
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        expect(onOrderRefreshed).not.toHaveBeenCalled();
        expect(result.current.proofRefreshPending).toBe(true);
    });

    test('a late response after the dialog was reset cannot land on the next account', async () => {
        let resolve;
        uploadPaymentProof.mockReturnValue(new Promise((r) => { resolve = r; }));
        const { result } = await mount();
        act(() => result.current.setSelectedProof('img'));
        let pending;
        act(() => { pending = result.current.submitProof(); });
        expect(result.current.proofSending).toBe(true);

        act(() => result.current.resetProof());
        await act(async () => { resolve({ data: {} }); await pending; });
        expect(result.current.proofSent).toBe(false);
        expect(result.current.proofIntent).toBeNull();
        expect(getOrder).not.toHaveBeenCalled();
    });

    test('users that cannot send proofs never upload', async () => {
        const { result } = await mount({ canSubmitProof: false });
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        expect(uploadPaymentProof).not.toHaveBeenCalled();
    });
});

describe('usePaymentProof: reset', () => {
    test('resetProof clears the whole proof flow', async () => {
        const { result } = await mount();
        act(() => result.current.setSelectedProof('img'));
        await act(async () => { await result.current.submitProof(); });
        act(() => result.current.resetProof());
        const p = result.current;
        expect([p.selectedProof, p.proofIntent, p.proofSending, p.proofSent, p.proofError, p.proofRefreshPending, p.proofRefreshError])
            .toEqual(['', null, false, false, '', false, '']);
    });
});
