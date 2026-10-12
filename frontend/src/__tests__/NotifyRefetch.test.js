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

// A stream that says hello and then either ends (server dropped us) or stays open.
const stream = ({ ends }) => ({
    ok: true,
    status: 200,
    body: {
        getReader: () => {
            let sent = false;
            return {
                read: () => {
                    if (!sent) { sent = true; return Promise.resolve({ done: false, value: encoder.encode('data: {"type":"hello"}\n\n') }); }
                    return ends ? Promise.resolve({ done: true }) : new Promise(() => {});
                },
            };
        },
    },
});

let root;
let host;
const settle = async (ms = 0) => {
    for (let i = 0; i < 6; i += 1) {
        await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); });
    }
};
const mount = async () => {
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => { root.render(<NotifyProvider><Probe /></NotifyProvider>); });
    await settle();
};

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.setItem('token', 'tkn');
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
    delete global.fetch;
    localStorage.clear();
});

describe('NotifyContext refetch triggers', () => {
    it('does not bump on the very first connect', async () => {
        global.fetch = jest.fn().mockResolvedValue(stream({ ends: false }));
        await mount();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(seen.current.generation).toBe(0);
    });

    it('bumps once after a successful reconnect', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce(stream({ ends: true }))
            .mockResolvedValue(stream({ ends: false }));
        await mount();
        await settle(2000);
        expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(seen.current.generation).toBe(1);
    });

    it('bumps once per wake even when visibility, online and focus fire together', async () => {
        global.fetch = jest.fn().mockResolvedValue(stream({ ends: false }));
        await mount();
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('focus'));
        });
        await settle(1000);
        expect(seen.current.generation).toBe(1);
        // A later, separate wake bumps again.
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await settle(1000);
        expect(seen.current.generation).toBe(2);
    });

    it('ignores a tab going hidden', async () => {
        global.fetch = jest.fn().mockResolvedValue(stream({ ends: false }));
        await mount();
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await settle(1000);
        expect(seen.current.generation).toBe(0);
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
});
