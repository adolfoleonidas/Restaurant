import { createLineSyncQueue } from '@/lib/lineSyncQueue';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lineSyncQueue', () => {
    test('taps made in the same tick are coalesced into one run with the net quantity', async () => {
        const run = jest.fn().mockResolvedValue();
        const queue = createLineSyncQueue({ run });
        queue.set('line:a', { quantity: 3 });
        queue.set('line:a', { quantity: 4 });
        queue.set('line:a', { quantity: 5 });
        await queue.whenIdle();
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][0]).toBe('line:a');
        expect(run.mock.calls[0][1].quantity).toBe(5);
        expect(queue.busy()).toBe(false);
    });

    test('keeps one request in flight per line and sends the taps made meanwhile afterwards', async () => {
        const first = deferred();
        const run = jest.fn()
            .mockImplementationOnce(() => first.promise)
            .mockResolvedValue();
        const queue = createLineSyncQueue({ run });
        queue.set('line:a', { quantity: 3 });
        await tick();
        expect(run).toHaveBeenCalledTimes(1);

        queue.set('line:a', { quantity: 4 });
        queue.set('line:a', { quantity: 5 });
        await tick();
        expect(run).toHaveBeenCalledTimes(1);
        // The pending value is readable at once (this is what the screen shows).
        expect(queue.get('line:a').quantity).toBe(5);

        first.resolve();
        await queue.whenIdle();
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[1][1].quantity).toBe(5);
    });

    test('never runs two lines at the same time', async () => {
        let active = 0;
        let peak = 0;
        const run = jest.fn(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await tick();
            active -= 1;
        });
        const queue = createLineSyncQueue({ run });
        queue.set('line:a', { quantity: 1 });
        queue.set('line:b', { quantity: 1 });
        queue.set('new:c', { quantity: 1 });
        await queue.whenIdle();
        expect(run).toHaveBeenCalledTimes(3);
        expect(peak).toBe(1);
    });

    test('a failed run drops that line, reports it, and still syncs the other lines', async () => {
        const run = jest.fn(async (key) => { if (key === 'line:a') throw new Error('boom'); });
        const onError = jest.fn();
        const queue = createLineSyncQueue({ run, onError });
        queue.set('line:a', { quantity: 2 });
        queue.set('line:b', { quantity: 2 });
        await queue.whenIdle();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBe('line:a');
        expect(onError.mock.calls[0][1].message).toBe('boom');
        expect(run).toHaveBeenCalledWith('line:b', expect.anything());
        expect(queue.get('line:a')).toBeUndefined();
        expect(queue.failures()).toBe(1);
    });

    test('reports each change and a single drain when the queue empties', async () => {
        const onChange = jest.fn();
        const onDrain = jest.fn();
        const queue = createLineSyncQueue({ run: jest.fn().mockResolvedValue(), onChange, onDrain });
        queue.set('line:a', { quantity: 1 });
        queue.set('line:b', { quantity: 1 });
        await queue.whenIdle();
        expect(onChange).toHaveBeenCalled();
        expect(onDrain).toHaveBeenCalledTimes(1);
    });

    test('whenIdle resolves at once when nothing is pending', async () => {
        const queue = createLineSyncQueue({ run: jest.fn() });
        await expect(queue.whenIdle()).resolves.toBeUndefined();
    });

    test('a line that gets more taps while it runs goes to the back so the others are not starved', async () => {
        const order = [];
        const first = deferred();
        const run = jest.fn(async (key) => {
            order.push(key);
            if (order.length === 1) await first.promise;
        });
        const queue = createLineSyncQueue({ run });
        queue.set('line:a', { quantity: 1 });
        queue.set('line:b', { quantity: 1 });
        await tick();
        queue.set('line:a', { quantity: 2 });
        first.resolve();
        await queue.whenIdle();
        expect(order).toEqual(['line:a', 'line:b', 'line:a']);
    });
});
