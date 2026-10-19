import {
    STREAM_IDLE_MS,
    STREAM_BACKOFF_BASE_MS,
    STREAM_BACKOFF_CAP_MS,
    StreamIdleError,
    nextBackoffMs,
    withIdleTimeout,
} from '@/lib/streamResilience';

describe('stream resilience helpers', () => {
    describe('thresholds', () => {
        it('idles out after three missed server keepalives (15 s each)', () => {
            expect(STREAM_IDLE_MS).toBe(45000);
        });
    });

    describe('nextBackoffMs', () => {
        // random = 1 is the top of the jitter window: the plain exponential value.
        it('doubles from the base on each attempt', () => {
            const delays = [0, 1, 2, 3].map((n) => nextBackoffMs(n, () => 1));
            expect(delays).toEqual([1500, 3000, 6000, 12000]);
        });

        it('never exceeds the cap, however many attempts', () => {
            expect(nextBackoffMs(5, () => 1)).toBe(STREAM_BACKOFF_CAP_MS);
            expect(nextBackoffMs(50, () => 1)).toBe(STREAM_BACKOFF_CAP_MS);
            expect(nextBackoffMs(1000, () => 1)).toBe(STREAM_BACKOFF_CAP_MS);
        });

        it('spreads the delay: the bottom of the window is half the exponential value', () => {
            expect(nextBackoffMs(0, () => 0)).toBe(STREAM_BACKOFF_BASE_MS / 2);
            expect(nextBackoffMs(2, () => 0)).toBe(3000);
        });

        it('stays inside its window for real random values', () => {
            for (let i = 0; i < 50; i += 1) {
                const d = nextBackoffMs(3);
                expect(d).toBeGreaterThanOrEqual(6000);
                expect(d).toBeLessThanOrEqual(12000);
            }
        });
    });

    describe('withIdleTimeout', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('passes the value through when the promise settles in time', async () => {
            await expect(withIdleTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
        });

        it('passes the original rejection through', async () => {
            const boom = new Error('boom');
            await expect(withIdleTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom);
        });

        it('rejects with StreamIdleError when nothing settles in time', async () => {
            const p = withIdleTimeout(new Promise(() => {}), 1000);
            const assertion = expect(p).rejects.toBeInstanceOf(StreamIdleError);
            jest.advanceTimersByTime(1001);
            await assertion;
        });

        it('does not fire after the promise settled', async () => {
            const onIdle = jest.fn();
            await withIdleTimeout(Promise.resolve(1), 1000, onIdle);
            jest.advanceTimersByTime(5000);
            expect(onIdle).not.toHaveBeenCalled();
        });

        it('calls onIdle when it times out', async () => {
            const onIdle = jest.fn();
            const p = withIdleTimeout(new Promise(() => {}), 1000, onIdle).catch(() => {});
            jest.advanceTimersByTime(1001);
            await p;
            expect(onIdle).toHaveBeenCalledTimes(1);
        });
    });
});
