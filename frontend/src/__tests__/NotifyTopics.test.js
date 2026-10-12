/**
 * TR-02: screens refetch only for the realtime topics they render. Reconnect,
 * wake and events without a topic still refresh everyone (AF-03 parity).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { NotifyProvider, useNotify, useRealtimeGeneration } from '@/contexts/NotifyContext';

global.IS_REACT_ACT_ENVIRONMENT = true;
global.TextDecoder = global.TextDecoder || NodeTextDecoder;
const encoder = new NodeTextEncoder();

jest.mock('@/lib/api', () => ({ API: '/api' }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const seen = {};
function Probe() {
    seen.legacy = useNotify().generation;
    seen.orders = useRealtimeGeneration(['orders']);
    seen.tables = useRealtimeGeneration(['tables']);
    seen.both = useRealtimeGeneration(['orders', 'tables']);
    seen.catalog = useRealtimeGeneration('catalog');
    seen.mine = useRealtimeGeneration(['orders'], (ev) => ev.order_id === 'o1');
    return null;
}

// A stream the test feeds by hand; `end()` makes the server drop the connection.
function controllableStream() {
    const waiting = [];
    const buffered = [];
    const deliver = (chunk) => {
        if (waiting.length) waiting.shift()(chunk);
        else buffered.push(chunk);
    };
    deliver({ done: false, value: encoder.encode('data: {"type":"hello"}\n\n') });
    return {
        push: (event) => deliver({ done: false, value: encoder.encode(`data: ${JSON.stringify(event)}\n\n`) }),
        end: () => deliver({ done: true }),
        response: {
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: () => {
                        if (buffered.length) return Promise.resolve(buffered.shift());
                        return new Promise((resolve) => { waiting.push(resolve); });
                    },
                }),
            },
        },
    };
}

let root;
let host;
let streams;
// Moves the clock once, then lets pending promise continuations run.
const settle = async (ms = 0) => {
    await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); });
    for (let i = 0; i < 4; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    }
};
const push = async (event, which = 0) => {
    await act(async () => { streams[which].push(event); await Promise.resolve(); await Promise.resolve(); });
    await settle(300);
};
const snapshot = () => ({ ...seen });

beforeEach(async () => {
    jest.useFakeTimers();
    localStorage.setItem('token', 'tkn');
    streams = [controllableStream(), controllableStream()];
    let call = 0;
    global.fetch = jest.fn(() => Promise.resolve(streams[Math.min(call++, streams.length - 1)].response));
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

describe('useRealtimeGeneration', () => {
    it('starts at zero everywhere', () => {
        expect(snapshot()).toEqual({ legacy: 0, orders: 0, tables: 0, both: 0, catalog: 0, mine: 0 });
    });

    it('an orders event bumps only the screens that render orders', async () => {
        await push({ type: 'order', order_id: 'o1', topic: 'orders', topics: ['orders', 'kitchen'] });
        expect(snapshot()).toEqual({ legacy: 1, orders: 1, tables: 0, both: 1, catalog: 0, mine: 1 });
    });

    it('a tables event does not bump the orders screens', async () => {
        await push({ type: 'table', table_id: 't1', topic: 'tables', topics: ['tables'] });
        expect(snapshot()).toEqual({ legacy: 1, orders: 0, tables: 1, both: 1, catalog: 0, mine: 0 });
    });

    it('matches any of the topics of a multi-topic event', async () => {
        await push({ type: 'order', order_id: 'o9', topic: 'orders', topics: ['orders', 'kitchen', 'payments'] });
        expect(seen.orders).toBe(1);
    });

    it('accepts an event with only the primary topic', async () => {
        await push({ type: 'product', topic: 'catalog' });
        expect(snapshot()).toEqual({ legacy: 1, orders: 0, tables: 0, both: 0, catalog: 1, mine: 0 });
    });

    it('an event naming a topic this client does not know refreshes everyone', async () => {
        // A newer backend may publish topics an older cached client has never heard of.
        await push({ type: 'order', order_id: 'zzz', topic: 'orders', topics: ['orders', 'loyalty'] });
        expect(snapshot()).toEqual({ legacy: 1, orders: 1, tables: 1, both: 1, catalog: 1, mine: 1 });
    });

    it('a filter ignores events of other orders', async () => {
        await push({ type: 'order', order_id: 'o2', topic: 'orders', topics: ['orders'] });
        expect(seen.orders).toBe(1);
        expect(seen.mine).toBe(0);
        await push({ type: 'order', order_id: 'o1', topic: 'orders', topics: ['orders'] });
        expect(seen.mine).toBe(1);
    });

    it('an event without a topic bumps every subscription, filter included', async () => {
        await push({ type: 'something_new', order_id: 'zzz' });
        expect(snapshot()).toEqual({ legacy: 1, orders: 1, tables: 1, both: 1, catalog: 1, mine: 1 });
    });

    it('a burst of matching events bumps once; non-matching events never do', async () => {
        for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => { streams[0].push({ type: 'order', order_id: `o${i}`, topics: ['orders'] }); await Promise.resolve(); await Promise.resolve(); });
            // eslint-disable-next-line no-await-in-loop
            await settle(50);
        }
        expect(seen.orders).toBe(0);
        await settle(300);
        expect(seen.orders).toBe(1);
        expect(seen.tables).toBe(0);
    });

    it('a non-stop stream of one topic still refreshes it within the max wait', async () => {
        for (let i = 0; i < 40; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => { streams[0].push({ type: 'order', order_id: 'o1', topics: ['orders'] }); await Promise.resolve(); await Promise.resolve(); });
            // eslint-disable-next-line no-await-in-loop
            await settle(100);
        }
        expect(seen.orders).toBeGreaterThanOrEqual(2);
        expect(seen.orders).toBeLessThan(10);
        expect(seen.catalog).toBe(0);
    });

    it('a reconnect refreshes every topic', async () => {
        await act(async () => { streams[0].end(); await Promise.resolve(); await Promise.resolve(); });
        await settle(600);
        expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(snapshot()).toEqual({ legacy: 1, orders: 1, tables: 1, both: 1, catalog: 1, mine: 1 });
    });

    it('waking up refreshes every topic once', async () => {
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await settle(400);
        expect(snapshot()).toEqual({ legacy: 1, orders: 1, tables: 1, both: 1, catalog: 1, mine: 1 });
    });

    it('does nothing outside a provider', async () => {
        const solo = { value: null };
        function Alone() {
            solo.value = useRealtimeGeneration(['orders']);
            return null;
        }
        const el = document.createElement('div');
        const r = createRoot(el);
        await act(async () => { r.render(<Alone />); });
        expect(solo.value).toBe(0);
        await act(async () => r.unmount());
    });
});
