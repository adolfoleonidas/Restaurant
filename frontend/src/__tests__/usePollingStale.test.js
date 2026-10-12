import { act } from 'react';
import usePolling from '@/hooks/usePolling';
import { renderHook } from '@/test-utils/renderHook';

describe('usePolling response ordering', () => {
    afterEach(() => jest.useRealTimers());

    test('a slow older response never overwrites a newer one', async () => {
        const resolvers = [];
        const fetcher = jest.fn(() => new Promise((resolve) => { resolvers.push(resolve); }));
        const hook = await renderHook(() => usePolling(fetcher, 60000, []));
        // Mount started request #1; the user action triggers #2.
        let second;
        await act(async () => { second = hook.result.current.refetch(); });
        expect(resolvers).toHaveLength(2);
        await act(async () => { resolvers[1]('new'); await second; });
        expect(hook.result.current.data).toBe('new');
        await act(async () => { resolvers[0]('old'); await Promise.resolve(); await Promise.resolve(); });
        expect(hook.result.current.data).toBe('new');
        await hook.unmount();
    });

    test('an older failure does not clobber a newer success either', async () => {
        const settlers = [];
        const fetcher = jest.fn(() => new Promise((resolve, reject) => { settlers.push({ resolve, reject }); }));
        const hook = await renderHook(() => usePolling(fetcher, 60000, []));
        let second;
        await act(async () => { second = hook.result.current.refetch(); });
        await act(async () => { settlers[1].resolve('fresh'); await second; });
        await act(async () => { settlers[0].reject(new Error('late')); await Promise.resolve(); await Promise.resolve(); });
        expect(hook.result.current.data).toBe('fresh');
        expect(hook.result.current.error).toBeNull();
        await hook.unmount();
    });

    test('still applies responses in order', async () => {
        const fetcher = jest.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
        const hook = await renderHook(() => usePolling(fetcher, 60000, []));
        expect(hook.result.current.data).toBe('a');
        await act(async () => { await hook.result.current.refetch(); });
        expect(hook.result.current.data).toBe('b');
        await hook.unmount();
    });
});
