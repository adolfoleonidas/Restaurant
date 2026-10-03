import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Caja from '@/pages/Caja';
import { api } from '@/lib/api';

let mockUser;
const branchList = [
    { id: 'branch-1', name: 'Centro' },
    { id: 'branch-2', name: 'Norte' },
];
const openRegister = (branchId = 'branch-1', overrides = {}) => ({
    id: `register-${branchId}`, branch_id: branchId, status: 'open', opening_amount: 100,
    expected_amount: 100, opened_by_name: 'Owner', opened_at: '2026-10-03T10:00:00Z', movements: [], by_method: {},
    ...overrides,
});

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams()] }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
});
const change = async (element, value) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
});
const click = async (element) => act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

let views;
function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    views.push({ host, root });
    act(() => root.render(<Caja />));
    return { host, root };
}
function currentSelector(host) { return host.querySelector('[data-testid="caja-branch-context"]'); }

beforeEach(() => {
    views = [];
    mockUser = { id: 'owner-1', role: 'admin' };
    api.get.mockReset().mockImplementation((path, config = {}) => {
        const params = config.params || {};
        if (path === '/branches') return Promise.resolve({ data: branchList });
        if (path === '/cash') return Promise.resolve({ data: [
            { ...openRegister('branch-1'), branch_name: 'Centro' },
            { ...openRegister('branch-2'), branch_name: 'Norte' },
        ] });
        if (path === '/cash/current') return Promise.resolve({ data: params.legacy_only || params.branch_id ? null : openRegister('branch-1') });
        if (path === '/orders' || path === '/tables' || path === '/payments') return Promise.resolve({ data: [] });
        if (path === '/cash/history') return Promise.resolve({ data: { registers: [], sessions: 0, total_sales: 0, difference: 0 } });
        if (path === '/reports/products') return Promise.resolve({ data: { products: [] } });
        return Promise.resolve({ data: {} });
    });
    api.post.mockReset().mockResolvedValue({ data: {} });
});
afterEach(async () => {
    for (const { host, root } of views) {
        await act(async () => root.unmount());
        host.remove();
    }
    document.body.innerHTML = '';
    jest.clearAllMocks();
});

test('owner starts in read-only consolidated mode and never operates an arbitrary current register', async () => {
    const { host } = mount();
    await flush();
    const selector = currentSelector(host);
    expect(selector).not.toBeNull();
    expect(selector.value).toBe('all');
    expect(host.textContent).toContain('Caja consolidada');
    expect(host.textContent).toContain('Centro');
    expect(host.textContent).toContain('Norte');
    expect(host.querySelector('[data-testid="caja-apertura-submit"]')).toBeNull();
    expect(host.querySelector('[data-testid="caja-mov-submit"]')).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/cash/current', expect.anything());
});

test('consolidated list does not convert unavailable expected cash into zero', async () => {
    api.get.mockImplementation((path) => {
        if (path === '/branches') return Promise.resolve({ data: branchList });
        if (path === '/cash') {
            const missingExpected = openRegister('branch-2', { branch_name: 'Norte' });
            delete missingExpected.expected_amount;
            return Promise.resolve({ data: [
                openRegister('branch-1', { expected_amount: null, branch_name: 'Centro' }),
                missingExpected,
            ] });
        }
        if (path === '/orders' || path === '/tables' || path === '/payments') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: {} });
    });
    const { host } = mount();
    await flush();
    expect(host.textContent).not.toContain('Efectivo esperado: S/ 0.00');
});
test('selected branch scopes operational reads and new register opening', async () => {
    const { host } = mount();
    await flush();
    const selector = currentSelector(host);
    expect(selector).not.toBeNull();
    await change(selector, 'branch:branch-1');
    await flush();
    expect(api.get).toHaveBeenCalledWith('/cash/current', { params: { branch_id: 'branch-1' } });
    expect(api.get).toHaveBeenCalledWith('/orders', { params: { active_only: true, branch_id: 'branch-1' } });
    expect(api.get).toHaveBeenCalledWith('/tables', { params: { branch_id: 'branch-1' } });
    const amount = host.querySelector('[data-testid="caja-apertura-monto"]');
    const submit = host.querySelector('[data-testid="caja-apertura-submit"]');
    expect(amount).not.toBeNull();
    expect(submit).not.toBeNull();
    await change(amount, '125');
    await click(submit);
    await flush();
    expect(api.post).toHaveBeenCalledWith('/cash/open', { opening_amount: 125, notes: '', branch_id: 'branch-1' });
});

test('legacy reconciliation scopes reads explicitly and does not offer a new branchless opening', async () => {
    const { host } = mount();
    await flush();
    const selector = currentSelector(host);
    expect(selector).not.toBeNull();
    await change(selector, 'legacy');
    await flush();
    expect(api.get).toHaveBeenCalledWith('/cash/current', { params: { legacy_only: true } });
    expect(api.get).toHaveBeenCalledWith('/orders', { params: { active_only: true, legacy_only: true } });
    expect(api.get).toHaveBeenCalledWith('/tables', { params: { legacy_only: true } });
    expect(host.textContent).toMatch(/No hay una caja histórica abierta/);
    expect(host.querySelector('[data-testid="caja-apertura-submit"]')).toBeNull();
    expect(api.post).not.toHaveBeenCalledWith('/cash/open', expect.anything());
});

test('assigned staff has no owner context selector and relies on backend branch assignment', async () => {
    mockUser = { id: 'cashier-1', role: 'cajero', branch_id: 'branch-1' };
    const { host } = mount();
    await flush();
    expect(currentSelector(host)).toBeNull();
    const currentCall = api.get.mock.calls.find(([path]) => path === '/cash/current');
    expect(currentCall).toEqual(['/cash/current']);
    expect(api.get).toHaveBeenCalledWith('/orders', { params: { active_only: true } });
    expect(api.get).toHaveBeenCalledWith('/tables');
});

test('owner cannot switch branch while register opening is in flight', async () => {
    let resolveOpen;
    api.post.mockImplementation(() => new Promise((resolve) => { resolveOpen = resolve; }));
    const { host } = mount();
    await flush();
    const selector = currentSelector(host);
    expect(selector).not.toBeNull();
    await change(selector, 'branch:branch-1');
    await flush();
    const amount = host.querySelector('[data-testid="caja-apertura-monto"]');
    const submit = host.querySelector('[data-testid="caja-apertura-submit"]');
    expect(amount).not.toBeNull();
    expect(submit).not.toBeNull();
    await change(amount, '50');
    await click(submit);
    expect(selector.disabled).toBe(true);
    expect(selector.value).toBe('branch:branch-1');
    await act(async () => resolveOpen({ data: {} }));
    await flush();
    expect(selector.disabled).toBe(false);
});

test('stale branch catalog response cannot replace the catalog for a newly authenticated owner', async () => {
    let resolveFirst;
    api.get.mockImplementation((path, config = {}) => {
        if (path === '/branches' && mockUser.id === 'owner-1') return new Promise((resolve) => { resolveFirst = resolve; });
        if (path === '/branches') return Promise.resolve({ data: [{ id: 'branch-new', name: 'Nuevo' }] });
        const params = config.params || {};
        if (path === '/cash') return Promise.resolve({ data: [] });
        if (path === '/cash/current') return Promise.resolve({ data: params.legacy_only || params.branch_id ? null : openRegister('branch-1') });
        if (path === '/orders' || path === '/tables' || path === '/payments') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: { registers: [], sessions: 0, total_sales: 0, difference: 0 } });
    });
    const { host, root } = mount();
    await flush();
    const selector = currentSelector(host);
    expect(selector).not.toBeNull();
    expect(resolveFirst).toBeDefined();
    mockUser = { id: 'owner-2', role: 'admin' };
    await act(async () => root.render(<Caja />));
    await flush();
    expect(Array.from(currentSelector(host).options).some((option) => option.textContent === 'Nuevo')).toBe(true);
    await act(async () => resolveFirst({ data: [{ id: 'branch-old', name: 'Anterior' }] }));
    await flush();
    expect(Array.from(currentSelector(host).options).some((option) => option.textContent === 'Anterior')).toBe(false);
});






test('late current-register response from the previous branch cannot replace the new branch workspace', async () => {
    let resolveOldRegister;
    api.get.mockImplementation((path, config = {}) => {
        const params = config.params || {};
        if (path === '/branches') return Promise.resolve({ data: branchList });
        if (path === '/cash/current' && params.branch_id === 'branch-1') {
            return new Promise((resolve) => { resolveOldRegister = resolve; });
        }
        if (path === '/cash/current' && params.branch_id === 'branch-2') {
            return Promise.resolve({ data: openRegister('branch-2', { opening_amount: 222, opened_by_name: 'Norte cashier' }) });
        }
        if (path === '/cash/current') return Promise.resolve({ data: params.legacy_only ? null : openRegister('branch-1') });
        if (path === '/cash') return Promise.resolve({ data: [] });
        if (path === '/orders' || path === '/tables' || path === '/payments') return Promise.resolve({ data: [] });
        if (path === '/cash/history') return Promise.resolve({ data: { registers: [], sessions: 0, total_sales: 0, difference: 0 } });
        return Promise.resolve({ data: {} });
    });
    const { host } = mount();
    await flush();
    const selector = currentSelector(host);
    expect(selector).not.toBeNull();
    await change(selector, 'branch:branch-1');
    await flush();
    expect(resolveOldRegister).toBeDefined();
    await change(currentSelector(host), 'branch:branch-2');
    await flush();
    expect(api.get).toHaveBeenCalledWith('/cash/current', { params: { branch_id: 'branch-2' } });
    expect(host.textContent).toContain('Norte cashier');
    expect(host.textContent).toContain('222.00');
    await act(async () => resolveOldRegister({ data: openRegister('branch-1', { opening_amount: 111, opened_by_name: 'Centro cashier' }) }));
    await flush();
    expect(currentSelector(host).value).toBe('branch:branch-2');
    expect(host.textContent).toContain('Norte cashier');
    expect(host.textContent).not.toContain('Centro cashier');
    expect(host.textContent).not.toContain('111.00');
});

test('selected branch scopes payment and cash history reads without narrowing consolidated product reports', async () => {
    const originalGet = api.get.getMockImplementation();
    api.get.mockImplementation((path, config = {}) => {
        if (path === '/cash/current' && config.params?.branch_id === 'branch-1') {
            return Promise.resolve({ data: openRegister('branch-1') });
        }
        return originalGet(path, config);
    });
    const { host } = mount();
    await flush();
    await change(currentSelector(host), 'branch:branch-1');
    await flush();
    const historyButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Historial');
    expect(historyButton).not.toBeUndefined();
    await click(historyButton);
    await flush();
    expect(api.get).toHaveBeenCalledWith('/payments', { params: { period: 'day', limit: 200, branch_id: 'branch-1' } });
    await click(host.querySelector('[data-testid="caja-hist-turnos"]'));
    await flush();
    expect(api.get).toHaveBeenCalledWith('/cash/history', { params: { period: 'day', branch_id: 'branch-1' } });
    await click(host.querySelector('[data-testid="caja-hist-platos"]'));
    await flush();
    expect(host.textContent).toContain('Este reporte incluye todas las sucursales y no está filtrado por la selección de caja.');
    expect(api.get).toHaveBeenCalledWith('/reports/products', { params: { period: 'day' } });
});
