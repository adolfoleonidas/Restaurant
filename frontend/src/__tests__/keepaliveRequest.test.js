/**
 * BS-03: when the page may disappear (hidden, closing, about to reload) the batch
 * goes out through `fetch` with `keepalive`, which the browser finishes; axios
 * (an XHR) does not survive an unload.
 */
import { api } from '@/lib/api';
import { saveDraftLines } from '@/lib/api/orders';
import { keepaliveRequest } from '@/lib/api/request';

jest.mock('@/lib/api', () => ({
    API: 'https://api.example.test/api',
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const answer = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
});

const lines = [{ client_line_id: 'c1', product_id: 'p1', quantity: 2 }];

beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(answer({ id: 'o1', items: [] }));
    Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({ data: 'axios' }));
    localStorage.clear();
});
afterEach(() => {
    delete global.fetch;
    jest.useRealTimers();
});

describe('saveDraftLines', () => {
    it('goes through axios, with a timeout, in the normal case', async () => {
        await expect(saveDraftLines('o1', lines)).resolves.toEqual({ data: 'axios' });
        expect(api.put).toHaveBeenCalledWith('/orders/o1/draft-lines', { lines }, { timeout: 15000 });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('goes through fetch with keepalive when the page may disappear', async () => {
        localStorage.setItem('token', 'abc');
        const result = await saveDraftLines('o1', lines, { keepalive: true });

        expect(api.put).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.example.test/api/orders/o1/draft-lines');
        expect(options).toMatchObject({ method: 'PUT', keepalive: true });
        expect(options.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer abc' });
        expect(JSON.parse(options.body)).toEqual({ lines });
        expect(result).toEqual({ data: { id: 'o1', items: [] }, status: 200 });
    });

    it('falls back to axios when the browser has no fetch', async () => {
        delete global.fetch;
        await saveDraftLines('o1', lines, { keepalive: true });
        expect(api.put).toHaveBeenCalledTimes(1);
    });
});

describe('keepaliveRequest', () => {
    it('sends no authorization header without a session', async () => {
        await keepaliveRequest('PUT', '/orders/o1/draft-lines', { lines });
        expect(global.fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('rejects like axios does, so the error is read the same way', async () => {
        global.fetch.mockResolvedValue(answer({ detail: 'No se puede modificar un pedido cerrado' }, 400));
        await expect(keepaliveRequest('PUT', '/x', {})).rejects.toMatchObject({
            response: { status: 400, data: { detail: 'No se puede modificar un pedido cerrado' } },
        });
    });

    it('rejects with the status when the answer has no body', async () => {
        const noBody = answer(null, 503);
        noBody.json.mockRejectedValue(new Error('no body'));
        global.fetch.mockResolvedValue(noBody);
        await expect(keepaliveRequest('PUT', '/x', {})).rejects.toMatchObject({ response: { status: 503, data: null } });
    });

    it('lets a network failure through untouched, so it counts as a bad connection', async () => {
        global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(keepaliveRequest('PUT', '/x', {})).rejects.toThrow('Failed to fetch');
    });

    it('gives up on a request that hangs', async () => {
        jest.useFakeTimers();
        let signal;
        global.fetch.mockImplementation((url, options) => new Promise((resolve, reject) => {
            signal = options.signal;
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
        }));
        const pending = keepaliveRequest('PUT', '/x', {});
        const assertion = expect(pending).rejects.toThrow(/aborted/);
        jest.advanceTimersByTime(15000);
        await assertion;
        expect(signal.aborted).toBe(true);
    });
});
