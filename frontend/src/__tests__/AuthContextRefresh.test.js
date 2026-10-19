/**
 * The stored user is only a boot-time snapshot: permissions granted after login
 * (a waiter given the 'cobro' function) must reach the app without a re-login,
 * so the provider refreshes the user from GET /auth/me.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { getMe } from '@/lib/api/auth';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/auth', () => ({ login: jest.fn(), getMe: jest.fn() }));

const STORED = { id: 'u1', name: 'Ana', role: 'mozo', functions: ['pedidos'] };
const FRESH = { ...STORED, functions: ['pedidos', 'cobro'] };

const seen = { current: null };
function Probe() {
    seen.current = useAuth();
    return null;
}

async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(<AuthProvider><Probe /></AuthProvider>);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
    return async () => { await act(async () => root.unmount()); host.remove(); };
}

describe('AuthProvider refreshes the stored user on boot', () => {
    beforeEach(() => {
        getMe.mockReset();
        localStorage.setItem('token', 'tkn');
        localStorage.setItem('user', JSON.stringify(STORED));
    });
    afterEach(() => { localStorage.clear(); seen.current = null; });

    it('replaces the stored user with the fresh /auth/me document (and persists it)', async () => {
        getMe.mockResolvedValue({ data: FRESH });
        const unmount = await mount();
        expect(getMe).toHaveBeenCalledTimes(1);
        expect(seen.current.user.functions).toContain('cobro');
        expect(JSON.parse(localStorage.getItem('user')).functions).toContain('cobro');
        expect(seen.current.loading).toBe(false);
        await unmount();
    });

    it('shows the stored user right away, before /auth/me answers', async () => {
        getMe.mockReturnValue(new Promise(() => {}));
        const unmount = await mount();
        expect(seen.current.user).toEqual(STORED);
        expect(seen.current.loading).toBe(false);
        await unmount();
    });

    it('keeps the stored user when the network fails (offline must still work)', async () => {
        getMe.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
        const unmount = await mount();
        expect(seen.current.user).toEqual(STORED);
        expect(JSON.parse(localStorage.getItem('user'))).toEqual(STORED);
        await unmount();
    });

    it('leaves a 401 to the axios interceptor: no extra logout from the provider', async () => {
        getMe.mockRejectedValue({ response: { status: 401 } });
        const unmount = await mount();
        expect(seen.current.user).toEqual(STORED);
        expect(localStorage.getItem('token')).toBe('tkn');
        await unmount();
    });

    it('does not call /auth/me without a stored session', async () => {
        localStorage.clear();
        const unmount = await mount();
        expect(getMe).not.toHaveBeenCalled();
        expect(seen.current.user).toBeNull();
        await unmount();
    });

    it('ignores a late answer after the session was closed', async () => {
        let resolve;
        getMe.mockReturnValue(new Promise((r) => { resolve = r; }));
        const unmount = await mount();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        await act(async () => { resolve({ data: FRESH }); await Promise.resolve(); await Promise.resolve(); });
        expect(localStorage.getItem('user')).toBeNull();
        await unmount();
    });
});
