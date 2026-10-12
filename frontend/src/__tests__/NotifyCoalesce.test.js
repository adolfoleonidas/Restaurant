/**
 * CP-02: a burst of realtime events asks the screens to refetch once, not once
 * per event. The reconnect and wake bumps (AF-03) keep their own behaviour and
 * are covered in NotifyRefetch.test.js.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { NotifyProvider, useNotify } from '@/contexts/NotifyContext';

global.IS_REACT_ACT_ENVIRONMENT = true;
global.TextDecoder = global.TextDecoder || NodeTextDecoder;
const encoder = new NodeTextEncoder();

jest.mock('@/lib/api', () => ({ API: '/api' }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const seen = { current: null };
function Probe() {
    seen.current = useNotify();
    return null;
}

// A stream the test feeds by hand: `push(event)` delivers one SSE message.
function controllableStream() {
    const waiting = [];
    const buffered = [];
    const deliver = (text) => {
        const value = encoder.encode(text);
        if (waiting.length) waiting.shift()({ done: false, value });
        else buffered.push(value);
    };
    deliver('data: {"type":"hello"}\n\n');
    return {
        push: (event) => deliver(`data: ${JSON.stringify(event)}\n\n`),
        response: {
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: () => {
                        if (buffered.length) return Promise.resolve({ done: false, value: buffered.shift() });
                        return new Promise((resolve) => { waiting.push(resolve); });
                    },
                }),
            },
        },
    };
}

let root;
let host;
let stream;
const settle = async (ms = 0) => {
    await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};
const push = async (event) => {
    await act(async () => { stream.push(event); await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(async () => {
    jest.useFakeTimers();
    localStorage.setItem('token', 'tkn');
    stream = controllableStream();
    global.fetch = jest.fn().mockResolvedValue(stream.response);
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => { root.render(<NotifyProvider><Probe /></NotifyProvider>); });
    await settle();
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
    delete global.fetch;
    localStorage.clear();
});

describe('NotifyContext event coalescing', () => {
    it('a burst of events bumps the generation once, after the burst goes quiet', async () => {
        for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await push({ type: 'order', id: `o${i}` });
            // eslint-disable-next-line no-await-in-loop
            await settle(50);
        }
        expect(seen.current.generation).toBe(0);
        // The last event is still available to those who read it.
        expect(seen.current.lastEvent).toEqual({ type: 'order', id: 'o4' });

        await settle(300);
        expect(seen.current.generation).toBe(1);
        await settle(2000);
        expect(seen.current.generation).toBe(1);
    });

    it('two bursts far apart bump twice', async () => {
        await push({ type: 'order', id: 'a' });
        await push({ type: 'order', id: 'b' });
        await settle(400);
        expect(seen.current.generation).toBe(1);

        await push({ type: 'order', id: 'c' });
        await settle(400);
        expect(seen.current.generation).toBe(2);
    });

    it('a non-stop stream still refetches while it keeps going', async () => {
        for (let i = 0; i < 40; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await push({ type: 'order', id: `o${i}` });
            // eslint-disable-next-line no-await-in-loop
            await settle(100);
        }
        // 4 seconds of events 100 ms apart: never quiet for 250 ms, yet it must not starve.
        expect(seen.current.generation).toBeGreaterThanOrEqual(2);
        expect(seen.current.generation).toBeLessThan(10);
    });
});
