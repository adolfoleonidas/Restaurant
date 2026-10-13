/**
 * BS-02: the outbox batches. A tap only changes the wanted quantity of its line;
 * the whole outbox of an order goes out in one request once the waiter pauses
 * (or at once when something asks for it), one request at a time.
 */
import { ORDER_SYNC_DELAY_MS, createLineSyncQueue, isTransientError } from '@/lib/lineSyncQueue';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

// Lets every pending promise callback run (fake timers do not move promises).
const settle = async () => {
    for (let i = 0; i < 30; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const advance = async (ms) => {
    jest.advanceTimersByTime(ms);
    await settle();
};

const httpError = (status, detail = 'No') => ({ response: { status, data: { detail } } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} });

const line = (orderId = 'o1', quantity = 1, extra = {}) => ({ kind: 'line', orderId, lineId: 'a', quantity, ...extra });

const make = (overrides = {}) => {
    const run = overrides.run || jest.fn().mockResolvedValue({});
    const handlers = {
        onChange: jest.fn(), onError: jest.fn(), onStalled: jest.fn(), onDrain: jest.fn(),
    };
    const queue = createLineSyncQueue({ run, ...handlers, ...overrides });
    return { queue, run, ...handlers };
};

const keysOf = (call) => call[0].items.map((item) => item.key);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('the batch window', () => {
    test('is a second and a half', () => {
        expect(ORDER_SYNC_DELAY_MS).toBe(1500);
    });

    test('nothing is sent while the waiter keeps tapping; one batch goes out after the last tap', async () => {
        const { queue, run } = make();
        queue.set('line:a', line('o1', 2));
        await advance(1000);
        queue.set('line:a', { quantity: 3 });
        await advance(1000);
        queue.set('line:b', line('o1', 1, { lineId: 'b' }));
        await advance(1499);
        expect(run).not.toHaveBeenCalled();

        await advance(1);
        expect(run).toHaveBeenCalledTimes(1);
        expect(keysOf(run.mock.calls[0])).toEqual(['line:a', 'line:b']);
        expect(run.mock.calls[0][0].orderId).toBe('o1');
    });

    test('taps on the same line collapse into the net absolute quantity', async () => {
        const { queue, run } = make();
        queue.set('line:a', line('o1', 3));
        queue.set('line:a', { quantity: 4 });
        queue.set('line:a', { quantity: 5 });
        await advance(ORDER_SYNC_DELAY_MS);

        expect(run).toHaveBeenCalledTimes(1);
        const [item] = run.mock.calls[0][0].items;
        expect(item.sent).toBe(5);
        expect(item.entry.quantity).toBe(5);
    });

    test('the window is injectable', async () => {
        const { queue, run } = make({ delayMs: 200 });
        queue.set('line:a', line());
        await advance(199);
        expect(run).not.toHaveBeenCalled();
        await advance(1);
        expect(run).toHaveBeenCalledTimes(1);
    });

    test('flush sends at once and resolves when the batch is confirmed', async () => {
        const gate = deferred();
        const run = jest.fn(() => gate.promise);
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 2));

        let done = false;
        const flushed = queue.flush().then(() => { done = true; });
        await settle();
        expect(run).toHaveBeenCalledTimes(1);
        expect(done).toBe(false);

        gate.resolve({});
        await flushed;
        expect(done).toBe(true);
        expect(queue.pending()).toBe(false);
        expect(queue.busy()).toBe(false);
        // The window that the tap armed was cancelled by the flush: no second request.
        await advance(ORDER_SYNC_DELAY_MS * 2);
        expect(run).toHaveBeenCalledTimes(1);
    });

    test('flush with nothing waiting resolves at once', async () => {
        const { queue, run } = make();
        await expect(queue.flush()).resolves.toBeUndefined();
        expect(run).not.toHaveBeenCalled();
    });

    test('flush({ keepalive }) tells the sender to use a request that survives the page', async () => {
        const { queue, run } = make();
        queue.set('line:a', line());
        await queue.flush({ keepalive: true });
        expect(run.mock.calls[0][1]).toEqual({ keepalive: true });

        queue.set('line:a', line('o1', 9));
        await queue.flush();
        expect(run.mock.calls[1][1]).toEqual({ keepalive: false });
    });
});

describe('one request at a time', () => {
    test('taps made while a batch is in flight wait for the next batch and carry the new quantity', async () => {
        const first = deferred();
        const run = jest.fn()
            .mockImplementationOnce(() => first.promise)
            .mockResolvedValue({});
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 3));
        await advance(ORDER_SYNC_DELAY_MS);
        expect(run).toHaveBeenCalledTimes(1);
        expect(queue.inFlight()).toBe(true);

        queue.set('line:a', { quantity: 4 });
        queue.set('line:a', { quantity: 5 });
        // The pending value is readable at once (this is what the screen shows).
        expect(queue.get('line:a').quantity).toBe(5);
        await advance(ORDER_SYNC_DELAY_MS);
        // Its window ran out while the first batch was still in flight: still one request.
        expect(run).toHaveBeenCalledTimes(1);

        first.resolve({});
        await settle();
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[1][0].items[0].sent).toBe(5);
        await settle();
        expect(queue.pending()).toBe(false);
    });

    test('a tap during the flight is not lost when the first batch is confirmed', async () => {
        const first = deferred();
        const run = jest.fn()
            .mockImplementationOnce(() => first.promise)
            .mockResolvedValue({});
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 3));
        await advance(ORDER_SYNC_DELAY_MS);
        queue.set('line:a', { quantity: 4 });

        first.resolve({});
        await settle();
        // Confirmed at 3, but the wanted 4 is still waiting.
        expect(queue.get('line:a').quantity).toBe(4);
        expect(queue.pending()).toBe(true);
        await advance(ORDER_SYNC_DELAY_MS);
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[1][0].items[0].sent).toBe(4);
    });

    test('a continuous burst does not turn into a request after every flight', async () => {
        const gates = [];
        const run = jest.fn(() => { const gate = deferred(); gates.push(gate); return gate.promise; });
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 1));
        await advance(ORDER_SYNC_DELAY_MS);
        queue.set('line:a', { quantity: 2 });
        gates[0].resolve({});
        await settle();
        // The flight ended, the waiter tapped a moment ago: wait for the window, do not chain.
        expect(run).toHaveBeenCalledTimes(1);
        await advance(ORDER_SYNC_DELAY_MS);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('flush while a batch is in flight waits for it and then sends what changed since', async () => {
        const first = deferred();
        const run = jest.fn()
            .mockImplementationOnce(() => first.promise)
            .mockResolvedValue({});
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 3));
        await advance(ORDER_SYNC_DELAY_MS);
        queue.set('line:a', { quantity: 7 });

        const flushed = queue.flush();
        await settle();
        expect(run).toHaveBeenCalledTimes(1);
        first.resolve({});
        await flushed;
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[1][0].items[0].sent).toBe(7);
        expect(queue.pending()).toBe(false);
    });

    test('lines of different orders go in separate batches, one after the other', async () => {
        let active = 0;
        let peak = 0;
        const run = jest.fn(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await settle();
            active -= 1;
            return {};
        });
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 1));
        queue.set('line:b', line('o2', 1, { lineId: 'b' }));
        queue.set('line:c', line('o1', 1, { lineId: 'c' }));
        await queue.flush();

        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls.map((call) => call[0].orderId)).toEqual(['o1', 'o2']);
        expect(keysOf(run.mock.calls[0])).toEqual(['line:a', 'line:c']);
        expect(peak).toBe(1);
    });
});

describe('a line with no order yet', () => {
    test('creates the order at once, without waiting for the window, and then waits for its batch', async () => {
        const resolveOrder = jest.fn().mockResolvedValue('o9');
        const { queue, run } = make({ resolveOrder });
        queue.set('new:p1', { kind: 'new', productId: 'p1', orderId: null, quantity: 1 });
        await settle();

        expect(resolveOrder).toHaveBeenCalledTimes(1);
        expect(run).not.toHaveBeenCalled();
        expect(queue.get('new:p1').orderId).toBe('o9');

        queue.set('new:p1', { quantity: 3 });
        queue.set('new:p2', { kind: 'new', productId: 'p2', orderId: null, quantity: 1 });
        await settle();
        // The second product joins the order that already exists.
        expect(resolveOrder).toHaveBeenCalledTimes(2);
        expect(queue.get('new:p2').orderId).toBe('o9');

        await advance(ORDER_SYNC_DELAY_MS);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0].orderId).toBe('o9');
        expect(run.mock.calls[0][0].items.map((item) => item.sent)).toEqual([3, 1]);
    });

    test('two products tapped before the order exists create it once', async () => {
        const gate = deferred();
        const resolveOrder = jest.fn(() => gate.promise);
        const { queue } = make({ resolveOrder });
        queue.set('new:p1', { kind: 'new', productId: 'p1', orderId: null, quantity: 1 });
        queue.set('new:p2', { kind: 'new', productId: 'p2', orderId: null, quantity: 2 });
        await settle();
        expect(resolveOrder).toHaveBeenCalledTimes(1);

        gate.resolve('o9');
        await settle();
        expect(queue.get('new:p1').orderId).toBe('o9');
        expect(queue.get('new:p2').orderId).toBe('o9');
    });

    test('when the caller says there is no order the taps are dropped quietly', async () => {
        const resolveOrder = jest.fn().mockResolvedValue(null);
        const { queue, run, onError } = make({ resolveOrder });
        queue.set('new:p1', { kind: 'new', productId: 'p1', orderId: null, quantity: 1 });
        await settle();

        expect(queue.pending()).toBe(false);
        expect(onError).not.toHaveBeenCalled();
        await advance(ORDER_SYNC_DELAY_MS);
        expect(run).not.toHaveBeenCalled();
    });

    test('when creating the order is refused the taps are dropped and reported once', async () => {
        const resolveOrder = jest.fn().mockRejectedValue(httpError(400, 'La mesa no está disponible'));
        const { queue, onError } = make({ resolveOrder });
        queue.set('new:p1', { kind: 'new', productId: 'p1', orderId: null, quantity: 1 });
        queue.set('new:p2', { kind: 'new', productId: 'p2', orderId: null, quantity: 1 });
        await settle();

        expect(queue.pending()).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].response.data.detail).toBe('La mesa no está disponible');
        expect(queue.failures()).toBe(1);
    });

    test('when the network fails while creating the order the taps stay and try again', async () => {
        const resolveOrder = jest.fn()
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue('o9');
        const { queue, onStalled, run } = make({ resolveOrder, retryMs: 1000 });
        queue.set('new:p1', { kind: 'new', productId: 'p1', orderId: null, quantity: 1 });
        await settle();
        expect(onStalled).toHaveBeenCalledTimes(1);
        expect(queue.pending()).toBe(true);

        // The retry creates the order and sends the line with it.
        await advance(1000);
        expect(resolveOrder).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0].orderId).toBe('o9');
        expect(queue.pending()).toBe(false);
    });
});

describe('the request id of an order creation', () => {
    // What the server needs to recognise a retry: one id per creation, repeated while it is retried.
    const want = (queue, key = 'new:p1') => {
        queue.set(key, { kind: 'new', productId: key.slice(4), orderId: null, quantity: 1 });
    };
    const idsOf = (resolveOrder) => resolveOrder.mock.calls.map(([context]) => context?.requestId);

    test('every retry of one creation sends the same id; the next account sends another', async () => {
        const resolveOrder = jest.fn()
            .mockRejectedValueOnce(networkError())
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue('o9');
        const { queue } = make({ resolveOrder });
        want(queue);
        await settle();
        // The answer never arrived twice: the server may already hold the order.
        await queue.flush();
        await queue.flush();

        expect(resolveOrder).toHaveBeenCalledTimes(3);
        const [first, second, third] = idsOf(resolveOrder);
        expect(first).toMatch(/^[A-Za-z0-9._:-]{8,64}$/);
        expect([second, third]).toEqual([first, first]);

        // The order exists now. Another account is another creation.
        want(queue, 'new:p2');
        await settle();
        expect(resolveOrder).toHaveBeenCalledTimes(4);
        expect(idsOf(resolveOrder)[3]).toMatch(/^[A-Za-z0-9._:-]{8,64}$/);
        expect(idsOf(resolveOrder)[3]).not.toBe(first);
    });

    test('two products tapped before the order exists ask for it once, with one id', async () => {
        const gate = deferred();
        const resolveOrder = jest.fn(() => gate.promise);
        const { queue } = make({ resolveOrder });
        want(queue, 'new:p1');
        want(queue, 'new:p2');
        await settle();

        expect(resolveOrder).toHaveBeenCalledTimes(1);
        expect(idsOf(resolveOrder)[0]).toEqual(expect.any(String));
        gate.resolve('o9');
        await settle();
    });

    test('a creation the server refused leaves its id behind', async () => {
        const resolveOrder = jest.fn()
            .mockRejectedValueOnce(httpError(409, 'Esa solicitud ya se usó para otro pedido. Vuelve a intentarlo.'))
            .mockResolvedValue('o9');
        const { queue, onError } = make({ resolveOrder });
        want(queue);
        await settle();
        expect(onError).toHaveBeenCalledTimes(1);

        want(queue, 'new:p2');
        await settle();
        const ids = idsOf(resolveOrder);
        expect(ids).toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
    });

    test('an answer of "no order wanted" ends the creation too', async () => {
        const resolveOrder = jest.fn().mockResolvedValueOnce(null).mockResolvedValue('o9');
        const { queue } = make({ resolveOrder });
        want(queue);
        await settle();
        want(queue, 'new:p2');
        await settle();

        const ids = idsOf(resolveOrder);
        expect(ids).toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
    });

    test('discarding the draft forgets the id of a creation that was still being retried', async () => {
        const resolveOrder = jest.fn().mockRejectedValueOnce(networkError()).mockResolvedValue('o9');
        const { queue } = make({ resolveOrder });
        want(queue);
        await settle();
        expect(queue.pending()).toBe(true);

        queue.clear();
        want(queue, 'new:p2');
        await settle();
        const ids = idsOf(resolveOrder);
        expect(ids).toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
    });
});

describe('what the server answers', () => {
    test('confirmed lines leave the outbox and one drain is announced', async () => {
        const { queue, onDrain } = make();
        queue.set('line:a', line('o1', 2));
        queue.set('line:b', line('o1', 1, { lineId: 'b' }));
        await queue.flush();

        expect(queue.snapshot()).toEqual({});
        expect(onDrain).toHaveBeenCalledTimes(1);
        expect(queue.failures()).toBe(0);
    });

    test('a rejected line is dropped and reported with its entry, the others are confirmed', async () => {
        const run = jest.fn().mockResolvedValue({ rejected: [{ key: 'line:a', error: httpError(400, 'Producto agotado: Sopa') }] });
        const { queue, onError } = make({ run });
        queue.set('line:a', line('o1', 2));
        queue.set('line:b', line('o1', 1, { lineId: 'b' }));
        await queue.flush();

        expect(onError).toHaveBeenCalledTimes(1);
        const [error, entry, key] = onError.mock.calls[0];
        expect(error.response.data.detail).toBe('Producto agotado: Sopa');
        expect(entry).toMatchObject({ lineId: 'a', quantity: 2 });
        expect(key).toBe('line:a');
        expect(queue.snapshot()).toEqual({});
        expect(queue.failures()).toBe(1);
    });

    test('a refused batch drops all its lines and reports once', async () => {
        const run = jest.fn().mockRejectedValue(httpError(400, 'No se puede modificar un pedido cerrado'));
        const { queue, onError, onStalled } = make({ run });
        queue.set('line:a', line('o1', 2));
        queue.set('line:b', line('o1', 1, { lineId: 'b' }));
        await queue.flush();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0].response.data.detail).toBe('No se puede modificar un pedido cerrado');
        expect(onError.mock.calls[0][3].map((e) => e.lineId)).toEqual(['a', 'b']);
        expect(onStalled).not.toHaveBeenCalled();
        expect(queue.pending()).toBe(false);
        expect(queue.failures()).toBe(1);
    });

    test('an error the server did not understand counts as a refusal, not as a bad connection', async () => {
        const run = jest.fn().mockRejectedValue(new Error('boom'));
        const { queue, onError, onStalled } = make({ run });
        queue.set('line:a', line());
        await queue.flush();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onStalled).not.toHaveBeenCalled();
        expect(queue.pending()).toBe(false);
    });

    test('a conflict is sent again twice before it counts as a refusal', async () => {
        const run = jest.fn()
            .mockRejectedValueOnce(httpError(409, 'El pedido cambió'))
            .mockRejectedValueOnce(httpError(409, 'El pedido cambió'))
            .mockResolvedValue({});
        const { queue, onError } = make({ run });
        queue.set('line:a', line('o1', 2));
        await queue.flush();

        expect(run).toHaveBeenCalledTimes(3);
        expect(onError).not.toHaveBeenCalled();
        expect(queue.pending()).toBe(false);

        const stubborn = jest.fn().mockRejectedValue(httpError(409, 'El pedido cambió'));
        const second = make({ run: stubborn });
        second.queue.set('line:a', line('o1', 2));
        await second.queue.flush();
        expect(stubborn).toHaveBeenCalledTimes(3);
        expect(second.onError).toHaveBeenCalledTimes(1);
        expect(second.queue.pending()).toBe(false);
    });
});

describe('when the connection fails', () => {
    test('the lines stay, the stall is reported and the outbox tries again with a growing pause', async () => {
        const run = jest.fn()
            .mockRejectedValueOnce(networkError())
            .mockRejectedValueOnce(networkError())
            .mockResolvedValue({});
        const { queue, onStalled, onError, onDrain } = make({ run, retryMs: 1000 });
        queue.set('line:a', line('o1', 2));
        await advance(ORDER_SYNC_DELAY_MS);

        expect(run).toHaveBeenCalledTimes(1);
        expect(onStalled).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        expect(queue.pending()).toBe(true);
        expect(queue.inFlight()).toBe(false);
        expect(queue.failures()).toBe(1);

        await advance(999);
        expect(run).toHaveBeenCalledTimes(1);
        await advance(1);
        expect(run).toHaveBeenCalledTimes(2);
        // The second pause is twice as long.
        await advance(1999);
        expect(run).toHaveBeenCalledTimes(2);
        await advance(1);
        expect(run).toHaveBeenCalledTimes(3);
        expect(queue.pending()).toBe(false);
        expect(onDrain).toHaveBeenCalledTimes(1);
    });

    test('a connection that just failed stops the pass: the other orders are not tried', async () => {
        const run = jest.fn().mockRejectedValue(networkError());
        const { queue, onStalled } = make({ run });
        queue.set('line:a', line('o1', 1));
        queue.set('line:b', line('o2', 1, { lineId: 'b' }));
        await queue.flush();

        expect(run).toHaveBeenCalledTimes(1);
        expect(onStalled).toHaveBeenCalledTimes(1);
        expect(queue.pending()).toBe(true);
        expect(Object.keys(queue.snapshot())).toEqual(['line:a', 'line:b']);
    });

    test('flush after a failure tries again at once and does not hang when it fails again', async () => {
        const run = jest.fn().mockRejectedValue(networkError());
        const { queue } = make({ run });
        queue.set('line:a', line());
        await queue.flush();
        expect(queue.pending()).toBe(true);

        await queue.flush();
        expect(run).toHaveBeenCalledTimes(2);
        expect(queue.pending()).toBe(true);
        expect(queue.busy()).toBe(true);
        expect(queue.inFlight()).toBe(false);
    });

    test.each([
        ['no answer', networkError(), true],
        ['a timeout', Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }), true],
        ['fetch failing', new TypeError('Failed to fetch'), true],
        ['an expired session', httpError(401), true],
        ['a busy server', httpError(503), true],
        ['too many requests', httpError(429), true],
        ['a refusal', httpError(400), false],
        ['a missing order', httpError(404), false],
        ['a server error', httpError(500), false],
        ['a bug', new Error('boom'), false],
    ])('%s is %s', (_, error, transient) => {
        expect(isTransientError(error)).toBe(transient);
    });
});

describe('what a previous session left', () => {
    test('restored entries are sent at once, flagged as they were saved', async () => {
        const { queue, run } = make();
        queue.restore([
            { key: 'line:a', kind: 'line', orderId: 'o1', lineId: 'a', quantity: 3 },
            { key: 'new:p1', kind: 'new', orderId: 'o1', productId: 'p1', clientLineId: 'c-1', quantity: 2, attempted: true },
        ]);
        await settle();

        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0].orderId).toBe('o1');
        expect(run.mock.calls[0][0].items.map((item) => [item.key, item.sent])).toEqual([['line:a', 3], ['new:p1', 2]]);
        expect(run.mock.calls[0][0].items[1].entry).not.toHaveProperty('key');
        expect(run.mock.calls[0][0].items[1].entry.attempted).toBe(true);
        expect(queue.pending()).toBe(false);
    });

    test('what the waiter tapped in this session wins over what was saved', async () => {
        const gate = deferred();
        const run = jest.fn(() => gate.promise);
        const { queue } = make({ run });
        queue.set('line:a', line('o1', 7));
        queue.restore([{ key: 'line:a', kind: 'line', orderId: 'o1', lineId: 'a', quantity: 3 }]);

        expect(queue.get('line:a').quantity).toBe(7);
        await settle();
        // Nothing new came back, so nothing was sent by the restore.
        expect(run).not.toHaveBeenCalled();
        gate.resolve({});
    });

    test('an empty or unusable list does nothing', async () => {
        const { queue, run } = make();
        queue.restore([]);
        queue.restore([{ quantity: 1 }]);
        await settle();
        expect(run).not.toHaveBeenCalled();
        expect(queue.pending()).toBe(false);
    });

    test('a failed connection keeps the restored entries for later', async () => {
        const run = jest.fn().mockRejectedValue(networkError());
        const { queue, onStalled } = make({ run });
        queue.restore([{ key: 'line:a', kind: 'line', orderId: 'o1', lineId: 'a', quantity: 3 }]);
        await settle();

        expect(onStalled).toHaveBeenCalledTimes(1);
        expect(queue.get('line:a')).toMatchObject({ quantity: 3 });
    });
});

describe('observing the outbox', () => {
    test('busy, pending and inFlight follow the life of a batch', async () => {
        const gate = deferred();
        const { queue } = make({ run: jest.fn(() => gate.promise) });
        expect([queue.busy(), queue.pending(), queue.inFlight()]).toEqual([false, false, false]);

        queue.set('line:a', line());
        expect([queue.busy(), queue.pending(), queue.inFlight()]).toEqual([true, true, false]);

        await advance(ORDER_SYNC_DELAY_MS);
        expect([queue.busy(), queue.pending(), queue.inFlight()]).toEqual([true, true, true]);

        gate.resolve({});
        await settle();
        expect([queue.busy(), queue.pending(), queue.inFlight()]).toEqual([false, false, false]);
    });

    test('onChange fires for every tap and for the start and end of a batch', async () => {
        const { queue, onChange } = make();
        queue.set('line:a', line());
        expect(onChange).toHaveBeenCalledTimes(1);
        onChange.mockClear();
        await queue.flush();
        expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('snapshot hands out copies', () => {
        const { queue } = make();
        queue.set('line:a', line('o1', 2));
        const copy = queue.snapshot();
        copy['line:a'].quantity = 99;
        expect(queue.get('line:a').quantity).toBe(2);
    });

    test('clear drops everything waiting and cancels the window', async () => {
        const { queue, run } = make();
        queue.set('line:a', line());
        queue.clear();
        expect(queue.pending()).toBe(false);
        await advance(ORDER_SYNC_DELAY_MS * 2);
        expect(run).not.toHaveBeenCalled();
    });

    test('destroy stops every timer', async () => {
        const { queue, run } = make();
        queue.set('line:a', line());
        queue.destroy();
        await advance(ORDER_SYNC_DELAY_MS * 2);
        expect(run).not.toHaveBeenCalled();
        queue.set('line:a', { quantity: 2 });
        await expect(queue.flush()).resolves.toBeUndefined();
        expect(run).not.toHaveBeenCalled();
    });

    test('a handler that throws cannot stall the outbox', async () => {
        const { queue, run } = make({
            onChange: () => { throw new Error('render'); },
            onDrain: () => { throw new Error('drain'); },
            onError: () => { throw new Error('toast'); },
            run: jest.fn().mockResolvedValue({ rejected: [{ key: 'line:a', error: httpError(400) }] }),
        });
        queue.set('line:a', line());
        queue.set('line:b', line('o1', 1, { lineId: 'b' }));
        await queue.flush();
        expect(run).toHaveBeenCalledTimes(1);
        expect(queue.pending()).toBe(false);
    });
});
