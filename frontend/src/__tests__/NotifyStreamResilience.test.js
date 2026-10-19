import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { NotifyProvider } from '@/contexts/NotifyContext';
import { expireSession } from '@/lib/authSession';

global.IS_REACT_ACT_ENVIRONMENT = true;
global.TextDecoder = global.TextDecoder || NodeTextDecoder;
const encoder = new NodeTextEncoder();

jest.mock('@/lib/api', () => ({ API: '/api' }));
jest.mock('@/lib/authSession', () => ({ expireSession: jest.fn() }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

// A stream that stays open and only delivers bytes when the test pushes them.
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

let root;
let host;
// Advances fake time in 1 s steps so timers and the promise chains they wake interleave.
const advance = async (ms) => {
    for (let left = ms; left > 0; left -= 1000) {
        await act(async () => {
            jest.advanceTimersByTime(Math.min(1000, left));
            await Promise.resolve();
            await Promise.resolve();
        });
    }
};
const mount = async () => {
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => { root.render(<NotifyProvider><span /></NotifyProvider>); });
    await advance(0);
};

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.setItem('token', 'tkn');
    expireSession.mockClear();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
    delete global.fetch;
    localStorage.clear();
});

describe('notification stream idle watchdog', () => {
    it('reconnects when the connection goes silent for 45 s', async () => {
        const first = openStream();
        const second = openStream();
        global.fetch = jest.fn()
            .mockResolvedValueOnce(first.res)
            .mockResolvedValue(second.res);
        await mount();
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await advance(44000);
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await advance(6000);
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

    it('also gives up on a connect that never answers', async () => {
        global.fetch = jest.fn()
            .mockReturnValueOnce(new Promise(() => {}))
            .mockResolvedValue(openStream().res);
        await mount();
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await advance(50000);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('aborts the stalled request so the browser drops the socket', async () => {
        const signals = [];
        global.fetch = jest.fn((url, init) => {
            signals.push(init.signal);
            return Promise.resolve(openStream().res);
        });
        await mount();
        await advance(50000);
        expect(signals.length).toBeGreaterThanOrEqual(2);
        expect(signals[0].aborted).toBe(true);
    });
});

describe('notification stream 401', () => {
    it('stops retrying and expires the session through the shared path', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, body: null });
        await mount();
        await advance(10000);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(expireSession).toHaveBeenCalledTimes(1);
    });

    it('does not expire the session on other failures', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, body: null });
        await mount();
        await advance(10000);
        expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
        expect(expireSession).not.toHaveBeenCalled();
    });
});
