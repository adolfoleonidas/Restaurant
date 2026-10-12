import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Dashboard from '@/pages/Dashboard';
import { api } from '@/lib/api';

let mockUser;
let mockParams;
const branches = [
    { id: 'branch-1', name: 'Centro' },
    { id: 'branch-2', name: 'Norte' },
];

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('react-router-dom', () => {
    const React = require('react');
    return {
        Navigate: ({ to }) => React.createElement('div', { 'data-testid': 'redirect', 'data-to': to }),
        Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
        useSearchParams: () => [mockParams, jest.fn()],
    };
});
jest.mock('@/components/ui/card', () => {
    const React = require('react');
    return {
        Card: ({ children, ...props }) => React.createElement('section', props, children),
        CardContent: ({ children, ...props }) => React.createElement('div', props, children),
    };
});
jest.mock('@/components/ui/button', () => {
    const React = require('react');
    return {
        Button: ({ asChild, children, ...props }) => asChild
            ? React.cloneElement(React.Children.only(children), props)
            : React.createElement('button', props, children),
    };
});
jest.mock('@/components/ui/textarea', () => {
    const React = require('react');
    return { Textarea: (props) => React.createElement('textarea', props) };
});
jest.mock('@/components/ui/dialog', () => {
    const React = require('react');
    return {
        Dialog: ({ open, children }) => open ? React.createElement('div', null, children) : null,
        DialogContent: ({ children, ...props }) => React.createElement('div', props, children),
        DialogFooter: ({ children }) => React.createElement('div', null, children),
        DialogHeader: ({ children }) => React.createElement('div', null, children),
        DialogTitle: ({ children }) => React.createElement('h2', null, children),
    };
});
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('lucide-react', () => {
    const React = require('react');
    const Icon = () => React.createElement('span');
    return { AlertTriangle: Icon, ArrowRight: Icon, ChefHat: Icon, Clock: Icon, Wallet: Icon };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const report = (occupied, openedBy = null) => ({
    generated_at: '2026-10-03T10:00:00+00:00',
    attention: [],
    summary: {
        occupied_tables: occupied,
        total_tables: occupied,
        kitchen_orders: 0,
        bill_requests: 0,
        cash_open: true,
        cash_opened_by: openedBy,
        active_orders: occupied,
    },
});
const flush = async () => act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
});
const change = async (element, value) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
});

let mounted;
function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    act(() => root.render(<Dashboard />));
    return { host, root };
}
function selector(host) { return host.querySelector('[data-testid="dashboard-branch-context"]'); }

beforeEach(() => {
    mounted = [];
    mockUser = { id: 'owner-1', restaurant_id: 'restaurant-1', role: 'admin' };
    mockParams = new URLSearchParams();
    api.get.mockReset().mockImplementation((path) => {
        if (path === '/branches') return Promise.resolve({ data: branches });
        if (path === '/reports/today') return Promise.resolve({ data: report(4, null) });
        return Promise.resolve({ data: {} });
    });
    api.post.mockReset().mockResolvedValue({ data: {} });
});

afterEach(async () => {
    for (const { host, root } of mounted) {
        await act(async () => root.unmount());
        host.remove();
    }
    document.body.innerHTML = '';
    jest.clearAllMocks();
});

test('owner defaults to consolidated context without auto-selecting a sole branch', async () => {
    mockUser = {
        id: 'owner-function', restaurant_id: 'restaurant-1', role: 'gerente', functions: ['administracion'],
    };
    api.get.mockImplementation((path) => {
        if (path === '/branches') return Promise.resolve({ data: [{ id: 'only-branch', name: 'Única' }] });
        if (path === '/reports/today') return Promise.resolve({ data: report(3) });
        return Promise.resolve({ data: {} });
    });
    const { host } = mount();
    await flush();

    expect(selector(host)).not.toBeNull();
    expect(selector(host).value).toBe('all');
    expect(Array.from(selector(host).options).map((option) => option.value)).toEqual([
        'all', 'branch:only-branch', 'legacy',
    ]);
    expect(api.get).toHaveBeenCalledWith('/reports/today');
    expect(host.textContent).toContain('disponibilidad de productos y las autorizaciones pendientes');
    expect(host.textContent).toContain('Responsable no individualizado');
});

test('owner selection sends only the corresponding today-report context', async () => {
    const { host } = mount();
    await flush();

    await change(selector(host), 'branch:branch-2');
    await flush();
    expect(api.get).toHaveBeenCalledWith('/reports/today', { params: { branch_id: 'branch-2' } });
    expect(host.textContent).toContain('Norte');
    expect(host.textContent).toContain('Responsable no individualizado');

    await change(selector(host), 'legacy');
    await flush();
    expect(api.get).toHaveBeenCalledWith('/reports/today', { params: { legacy_only: true } });
    expect(selector(host).value).toBe('legacy');
});

test('staff retain their existing redirect and never load owner branch catalog', async () => {
    mockUser = { id: 'cashier-1', restaurant_id: 'restaurant-1', role: 'cajero', branch_id: 'branch-1' };
    const { host } = mount();
    await flush();

    expect(host.querySelector('[data-testid="redirect"]')?.getAttribute('data-to')).toBe('/caja');
    expect(selector(host)).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/branches');
});

test('late report response from an old branch cannot replace the selected branch workspace', async () => {
    let resolveOldReport;
    api.get.mockImplementation((path, config = {}) => {
        if (path === '/branches') return Promise.resolve({ data: branches });
        if (path === '/reports/today' && config.params?.branch_id === 'branch-1') {
            return new Promise((resolve) => { resolveOldReport = resolve; });
        }
        if (path === '/reports/today' && config.params?.branch_id === 'branch-2') {
            return Promise.resolve({ data: report(2, 'Norte cashier') });
        }
        return Promise.resolve({ data: report(9, 'Consolidated') });
    });
    const { host } = mount();
    await flush();

    await change(selector(host), 'branch:branch-1');
    await flush();
    expect(resolveOldReport).toBeDefined();
    await change(selector(host), 'branch:branch-2');
    await flush();
    expect(host.textContent).toContain('Norte cashier');
    expect(host.textContent).toContain('2 / 2');

    await act(async () => resolveOldReport({ data: report(1, 'Centro cashier') }));
    await flush();
    expect(selector(host).value).toBe('branch:branch-2');
    expect(host.textContent).toContain('Norte cashier');
    expect(host.textContent).not.toContain('Centro cashier');
    expect(host.textContent).not.toContain('1 / 1');
});

test('late catalog and report responses from a previous auth identity are ignored', async () => {
    let resolveOldBranches;
    let resolveOldReport;
    api.get.mockImplementation((path) => {
        if (path === '/branches' && mockUser.id === 'owner-1') {
            return new Promise((resolve) => { resolveOldBranches = resolve; });
        }
        if (path === '/branches') return Promise.resolve({ data: [{ id: 'branch-new', name: 'Nueva' }] });
        if (path === '/reports/today' && mockUser.id === 'owner-1') {
            return new Promise((resolve) => { resolveOldReport = resolve; });
        }
        return Promise.resolve({ data: report(7, 'New owner') });
    });
    const { host, root } = mount();
    await flush();
    expect(resolveOldBranches).toBeDefined();
    expect(resolveOldReport).toBeDefined();

    mockUser = { id: 'owner-2', restaurant_id: 'restaurant-2', role: 'admin' };
    await act(async () => root.render(<Dashboard />));
    await flush();
    expect(Array.from(selector(host).options).some((option) => option.textContent === 'Nueva')).toBe(true);
    expect(host.textContent).toContain('New owner');

    await act(async () => resolveOldBranches({ data: [{ id: 'branch-old', name: 'Anterior' }] }));
    await act(async () => resolveOldReport({ data: report(1, 'Old owner') }));
    await flush();
    expect(Array.from(selector(host).options).some((option) => option.textContent === 'Anterior')).toBe(false);
    expect(host.textContent).toContain('New owner');
    expect(host.textContent).not.toContain('Old owner');
});

test('branch catalog failure reports the issue and offers no unverified branch option', async () => {
    api.get.mockImplementation((path) => {
        if (path === '/branches') return Promise.reject(new Error('unavailable'));
        if (path === '/reports/today') return Promise.resolve({ data: report(5) });
        return Promise.resolve({ data: {} });
    });
    const { host } = mount();
    await flush();

    expect(host.textContent).toContain('No se pudieron cargar las sucursales');
    expect(Array.from(selector(host).options).map((option) => option.value)).toEqual(['all', 'legacy']);
});

test('a removed selected branch fails closed without falling back to consolidated reads', async () => {
    api.get.mockImplementation((path, config = {}) => {
        if (path === '/branches') return Promise.resolve({ data: branches });
        if (path === '/reports/today' && config.params?.branch_id) {
            return Promise.reject({ response: { status: 404 } });
        }
        return Promise.resolve({ data: report(6, 'Consolidated owner') });
    });
    const { host } = mount();
    await flush();
    await change(selector(host), 'branch:branch-1');
    await flush();

    expect(selector(host).value).toBe('invalid');
    expect(host.textContent).toContain('No se puede consultar esta sucursal');
    const reportCalls = api.get.mock.calls.filter(([path]) => path === '/reports/today');
    expect(reportCalls).toHaveLength(2);
    expect(reportCalls[1][1]).toEqual({ params: { branch_id: 'branch-1' } });
    expect(host.textContent).not.toContain('Consolidated owner');
});
