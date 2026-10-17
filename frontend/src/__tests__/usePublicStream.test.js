import { act } from 'react';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import usePublicStream from '@/hooks/usePublicStream';
import { renderHook } from '@/test-utils/renderHook';

global.TextDecoder = global.TextDecoder || NodeTextDecoder;
const encoder = new NodeTextEncoder();

jest.mock('@/lib/api', () => ({ API: '/api' }));

const openStream = () => {
    let waiter = null;
    const reader = {
        read: jest.fn(() => new Promise((resolve) => { waiter = resolve; })),
        cancel: jest.fn(() => Promise.resolve()),
    };
    return {
        res: { ok: true, status: 200, body: { getReader: () => reader } },
        reader,
        push: (text) => { if (waiter) waiter({ done: false, value: encoder.encode(text) }); },
    };
};
const endedStream = () => ({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) },
});
const failure = { ok: false, status: 503, body: null };

let hook;
const advance = async (ms) => {
    for (let left = ms; left > 0; left -= 100) {
        await act(async () => {
            jest.advanceTimersByTime(Math.min(100, left));
            await Promise.resolve();
            await Promise.resolve();
        });
    }
};
const mount = async () => {
    hook = await renderHook(() => usePublicStream({ restaurantId: 'r1' }));
    await advance(0);
};

beforeEach(() => {
    jest.useFakeTimers();
    // Top of the jitter window: delays equal the plain exponential value.
    jest.spyOn(Math, 'random').mockReturnValue(1);
});
afterEach(async () => {
    await hook.unmount();
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete global.fetch;
});

describe('usePublicStream reconnect backoff', () => {
    it('waits longer after each consecutive failure (1.5 s, 3 s, 6 s...)', async () => {
        global.fetch = jest.fn().mockResolvedValue(failure);
        await mount();
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await advance(1400);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        await advance(200); // t = 1.6 s
        expect(global.fetch).toHaveBeenCalledTimes(2);

        await advance(2800);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        await advance(300); // t = 4.7 s
        expect(global.fetch).toHaveBeenCalledTimes(3);

        await advance(5600);
        expect(global.fetch).toHaveBeenCalledTimes(3);
        await advance(400); // t = 10.7 s
        expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('never waits more than the 30 s cap', async () => {
        global.fetch = jest.fn().mockResolvedValue(failure);
        await mount();
        // 1.5 + 3 + 6 + 12 + 24 s of waits, then every wait is capped at 30 s.
        await advance(46500 + 100);
        const before = global.fetch.mock.calls.length;
        await advance(30100);
        expect(global.fetch.mock.calls.length).toBe(before + 1);
        await advance(30100);
        expect(global.fetch.mock.calls.length).toBe(before + 2);
    });

    it('goes back to the base wait once a connection succeeds', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce(endedStream())
            .mockResolvedValue(failure);
        await mount();
        await advance(1600); // 2nd call
        await advance(3100); // 3rd call: connects, then the server ends the stream
        expect(global.fetch).toHaveBeenCalledTimes(3);

        // Without the reset the next wait would be 6 s; with it, the 1.5 s base.
        await advance(1600);
        expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('does not spin when the server keeps ending the stream at once', async () => {
        // Bounded on purpose: a loop that reconnects with no pause would otherwise
        // starve the test runner instead of failing the assertion.
        global.fetch = jest.fn().mockResolvedValue(openStream().res);
        for (let i = 0; i < 20; i += 1) global.fetch.mockResolvedValueOnce(endedStream());
        await mount();
        await advance(1000);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('stops reconnecting after unmount', async () => {
        global.fetch = jest.fn().mockResolvedValue(failure);
        await mount();
        await hook.unmount();
        const calls = global.fetch.mock.calls.length;
        await advance(60000);
        expect(global.fetch.mock.calls.length).toBe(calls);
        hook = { unmount: async () => {} };
    });
});

describe('usePublicStream idle watchdog', () => {
    it('reconnects when the connection goes silent for 45 s', async () => {
        const first = openStream();
        global.fetch = jest.fn()
            .mockResolvedValueOnce(first.res)
            .mockResolvedValue(openStream().res);
        await mount();
        await advance(44000);
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await advance(4000); // 45 s idle + the 1.5 s base wait
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(first.reader.cancel).toHaveBeenCalled();
    });

    it('stays connected while keepalive pings keep arriving', async () => {
        const stream = openStream();
        global.fetch = jest.fn().mockResolvedValue(stream.res);
        await mount();
        for (let i = 0; i < 8; i += 1) {
            await advance(15000);
            await act(async () => { stream.push(': ping\n\n'); await Promise.resolve(); });
        }
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('delivers events and still counts them', async () => {
        const stream = openStream();
        global.fetch = jest.fn().mockResolvedValue(stream.res);
        await mount();
        await act(async () => { stream.push('data: {"type":"order","id":"o1"}\n\n'); await Promise.resolve(); await Promise.resolve(); });
        expect(hook.result.current.generation).toBe(1);
        expect(hook.result.current.lastEvent).toEqual({ type: 'order', id: 'o1' });
    });
});
