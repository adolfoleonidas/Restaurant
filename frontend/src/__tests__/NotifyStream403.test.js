import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NotifyProvider } from '@/contexts/NotifyContext';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api', () => ({ API: '/api' }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

describe('notification stream', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.setItem('token', 'tkn');
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.fetch;
        localStorage.clear();
    });

    const mountAndWait = async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => { root.render(<NotifyProvider><span /></NotifyProvider>); });
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { jest.advanceTimersByTime(5000); await Promise.resolve(); });
        }
        await act(async () => root.unmount());
    };

    it('stops retrying after a 403', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, body: null });
        await mountAndWait();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('still retries other failures', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, body: null });
        await mountAndWait();
        expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
    });
});
