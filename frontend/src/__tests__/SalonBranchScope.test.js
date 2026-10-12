import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockNavigate = jest.fn();
const owner = { id: 'owner-1', restaurant_id: 'restaurant-1', role: 'admin' };
const mozo = { id: 'mozo-1', restaurant_id: 'restaurant-1', role: 'mozo', branch_id: 'branch-a' };
// El prefijo `mock` es obligatorio: `jest.mock` se eleva por encima de estas
// declaraciones y sólo acepta referencias con ese nombre.
let mockCurrentUser = owner;

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockCurrentUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const branches = [{ id: 'branch-a', name: 'Centro' }, { id: 'branch-b', name: 'Norte' }];
const unassigned = [{ id: 'table-x', number: 9, name: 'Mesa 9', area: 'Salón', status: 'disponible' }];
const mounted = [];

function tableCalls() {
    return api.get.mock.calls.filter(([path]) => path === '/tables');
}

function branchScopeOf(call) {
    return call[1]?.params?.branch_id || null;
}

async function renderSalon() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Salon />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    mounted.push({ host, root });
    return host;
}

async function unmountAll() {
    for (const view of mounted.splice(0)) {
        await act(async () => view.root.unmount());
        view.host.remove();
    }
    document.body.innerHTML = '';
}

beforeEach(() => {
    window.localStorage.clear();
    mockCurrentUser = owner;
    mockNavigate.mockClear();
    api.get.mockReset().mockImplementation((path, options) => {
        const params = options?.params || {};
        if (path === '/branches') return Promise.resolve({ data: branches });
        if (path === '/tables') return Promise.resolve({ data: params.legacy_only ? unassigned : [] });
        return Promise.resolve({ data: [] });
    });
});

afterEach(unmountAll);

describe('salón scope by branch', () => {
    it('scopes the floor to one branch for the owner and offers the branchless bucket', async () => {
        const host = await renderSalon();
        const select = host.querySelector('[data-testid="salon-sucursal"]');
        expect(Array.from(select.options).map((option) => option.value))
            .toEqual(['branch:branch-a', 'branch:branch-b', 'legacy']);
        expect(select.value).toBe('branch:branch-a');
        // El piso del dueño nunca pide "todas": pide un salón concreto.
        expect(tableCalls().some((call) => branchScopeOf(call) === null && !call[1]?.params?.legacy_only)).toBe(false);
        expect(tableCalls().some((call) => branchScopeOf(call) === 'branch-a')).toBe(true);
    });

    it('refetches the floor with the chosen branch and remembers it', async () => {
        const host = await renderSalon();
        api.get.mockClear();
        const select = host.querySelector('[data-testid="salon-sucursal"]');
        await act(async () => {
            select.value = 'branch:branch-b';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(tableCalls().some((call) => branchScopeOf(call) === 'branch-b')).toBe(true);
        expect(api.get.mock.calls.filter(([path]) => path === '/orders')
            .some(([, options]) => options?.params?.branch_id === 'branch-b')).toBe(true);
        expect(window.localStorage.getItem('salon-branch-scope:owner-1')).toBe('branch:branch-b');
    });

    it('opens on the remembered branch', async () => {
        window.localStorage.setItem('salon-branch-scope:owner-1', 'branch:branch-b');
        const host = await renderSalon();
        expect(host.querySelector('[data-testid="salon-sucursal"]').value).toBe('branch:branch-b');
        expect(tableCalls().some((call) => branchScopeOf(call) === 'branch-b')).toBe(true);
    });

    it('can look at the tables no branch owns', async () => {
        const host = await renderSalon();
        await act(async () => {
            const select = host.querySelector('[data-testid="salon-sucursal"]');
            select.value = 'legacy';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(tableCalls().some(([, options]) => options?.params?.legacy_only === true)).toBe(true);
    });

    it('keeps staff pinned by the server alone, with no selector', async () => {
        mockCurrentUser = mozo;
        const host = await renderSalon();
        expect(host.querySelector('[data-testid="salon-sucursal"]')).toBeNull();
        // El mozo no elige piso: el servidor ya lo acota a su sucursal.
        expect(tableCalls().every((call) => call[1] === undefined)).toBe(true);
    });

    it('warns that branchless tables are missing from every floor and links to the fix', async () => {
        const host = await renderSalon();
        const warning = host.querySelector('[data-testid="salon-mesas-sin-sucursal"]');
        expect(warning.textContent).toContain('1 mesa sin sucursal');
        await act(async () => host.querySelector('[data-testid="salon-ir-mesas-sin-sucursal"]').click());
        expect(mockNavigate).toHaveBeenCalledWith('/local?tab=mesas');
    });

    it('hides the warning while the owner is already looking at the branchless tables', async () => {
        window.localStorage.setItem('salon-branch-scope:owner-1', 'legacy');
        const host = await renderSalon();
        expect(host.querySelector('[data-testid="salon-mesas-sin-sucursal"]')).toBeNull();
    });
});
