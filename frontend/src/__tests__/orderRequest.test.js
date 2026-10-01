import { clearOrderRequestId, getOrderRequestId, submitPublicOrder } from '@/lib/orderRequest';

describe('public order request capability', () => {
    beforeEach(() => sessionStorage.clear());

    it('reuses the request id after a failed request and rotates after completion', () => {
        const cryptoSource = { randomUUID: jest.fn(() => 'first-id') };
        const retryId = getOrderRequestId(sessionStorage, cryptoSource);

        expect(getOrderRequestId(sessionStorage, cryptoSource)).toBe(retryId);
        clearOrderRequestId(sessionStorage);
        cryptoSource.randomUUID.mockReturnValue('next-id');
        expect(getOrderRequestId(sessionStorage, cryptoSource)).toBe('next-id');
    });

    it('keeps the exact request id after a failed API call and confirms before storage cleanup', async () => {
        const cryptoSource = { randomUUID: jest.fn().mockReturnValueOnce('request-a').mockReturnValueOnce('request-b') };
        const storage = {
            getItem: jest.fn((key) => sessionStorage.getItem(key)),
            setItem: jest.fn((key, value) => sessionStorage.setItem(key, value)),
            removeItem: jest.fn(() => { throw new Error('storage unavailable'); }),
        };
        const post = jest.fn().mockRejectedValueOnce(new Error('offline'));
        await expect(submitPublicOrder({ storage, cryptoSource, fingerprint: 'cart', payload: {}, post, onConfirmed: jest.fn() })).rejects.toThrow('offline');
        const requestId = getOrderRequestId(sessionStorage, cryptoSource, 'cart');
        const onConfirmed = jest.fn();
        post.mockResolvedValueOnce({ data: { tracking_code: 'owner-ticket' } });
        await expect(submitPublicOrder({ storage, cryptoSource, fingerprint: 'cart', payload: {}, post, onConfirmed })).resolves.toEqual({ tracking_code: 'owner-ticket' });
        expect(onConfirmed).toHaveBeenCalledWith({ tracking_code: 'owner-ticket' });
        expect(storage.removeItem).toHaveBeenCalled();
        expect(requestId).toBe('request-a');
        expect(post.mock.calls[0][0].request_id).toBe(post.mock.calls[1][0].request_id);
        expect(getOrderRequestId(storage, cryptoSource, 'cart')).toBe('request-b');
    });

    it('rotates the request id for a new completed cart', async () => {
        const cryptoSource = { randomUUID: jest.fn().mockReturnValueOnce('first').mockReturnValueOnce('second') };
        const post = jest.fn().mockResolvedValue({ data: { tracking_code: 'ticket' } });
        await submitPublicOrder({ storage: sessionStorage, cryptoSource, fingerprint: 'first-cart', payload: {}, post, onConfirmed: jest.fn() });
        await submitPublicOrder({ storage: sessionStorage, cryptoSource, fingerprint: 'next-cart', payload: {}, post, onConfirmed: jest.fn() });
        expect(post.mock.calls.map(([payload]) => payload.request_id)).toEqual(['first', 'second']);
    });

    it('uses secure random bytes when randomUUID is unavailable', () => {
        const cryptoSource = {
            getRandomValues: jest.fn((bytes) => {
                bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
                return bytes;
            }),
        };

        expect(getOrderRequestId(sessionStorage, cryptoSource)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    });

    it('fails closed when secure random generation is unavailable', () => {
        expect(() => getOrderRequestId(sessionStorage, {})).toThrow(/secure randomness/i);
    });
});
