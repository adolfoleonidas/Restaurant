/**
 * CP-02: a poll that brings back what the screen already has must not commit.
 */
import { act } from 'react';
import usePolling from '@/hooks/usePolling';
import { renderHook } from '@/test-utils/renderHook';

describe('usePolling unchanged payloads', () => {
    afterEach(() => jest.useRealTimers());

    const mountCounting = async (fetcher, interval = 60000) => {
        const counter = { renders: 0 };
        const hook = await renderHook(() => {
            counter.renders += 1;
            return usePolling(fetcher, interval, []);
        });
        return { hook, counter };
    };

    test('an equal payload keeps the same data object and does not re-render', async () => {
        const fetcher = jest.fn(async () => ({ rows: [{ id: 1, name: 'Mesa 1' }], total: 3 }));
        const { hook, counter } = await mountCounting(fetcher);
        const first = hook.result.current.data;
        const rendersBefore = counter.renders;

        await act(async () => { await hook.result.current.refetch(); });
        await act(async () => { await hook.result.current.refetch(); });

        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(hook.result.current.data).toBe(first);
        expect(counter.renders).toBe(rendersBefore);
        await hook.unmount();
    });

    test('interval ticks that bring nothing new do not commit either', async () => {
        jest.useFakeTimers();
        const fetcher = jest.fn(async () => [{ id: 'a' }]);
        const { hook, counter } = await mountCounting(fetcher, 1000);
        const rendersBefore = counter.renders;

        for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => { jest.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });
        }

        expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(4);
        expect(counter.renders).toBe(rendersBefore);
        await hook.unmount();
    });

    test('a changed payload still commits and replaces the data', async () => {
        const fetcher = jest.fn()
            .mockResolvedValueOnce({ rows: [1] })
            .mockResolvedValueOnce({ rows: [1, 2] });
        const { hook, counter } = await mountCounting(fetcher);
        const rendersBefore = counter.renders;

        await act(async () => { await hook.result.current.refetch(); });

        expect(hook.result.current.data).toEqual({ rows: [1, 2] });
        expect(counter.renders).toBeGreaterThan(rendersBefore);
        await hook.unmount();
    });

    test('going back to an earlier payload is a change, not a skip', async () => {
        const fetcher = jest.fn()
            .mockResolvedValueOnce('a')
            .mockResolvedValueOnce('b')
            .mockResolvedValueOnce('a');
        const { hook } = await mountCounting(fetcher);
        await act(async () => { await hook.result.current.refetch(); });
        expect(hook.result.current.data).toBe('b');
        await act(async () => { await hook.result.current.refetch(); });
        expect(hook.result.current.data).toBe('a');
        await hook.unmount();
    });

    test('a recovered request clears the error even when the data did not change', async () => {
        const fetcher = jest.fn()
            .mockResolvedValueOnce({ ok: true })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ ok: true });
        const { hook } = await mountCounting(fetcher);
        await act(async () => { await hook.result.current.refetch(); });
        expect(hook.result.current.error).toBeInstanceOf(Error);
        await act(async () => { await hook.result.current.refetch(); });
        expect(hook.result.current.error).toBeNull();
        expect(hook.result.current.data).toEqual({ ok: true });
        await hook.unmount();
    });

    test('payloads that cannot be serialised are simply committed', async () => {
        const circular = {};
        circular.self = circular;
        const fetcher = jest.fn(async () => circular);
        const { hook } = await mountCounting(fetcher);
        expect(hook.result.current.data).toBe(circular);
        await act(async () => { await hook.result.current.refetch(); });
        expect(hook.result.current.data).toBe(circular);
        await hook.unmount();
    });
});
