import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Reportes from '@/pages/Reportes';
import { api } from '@/lib/api';

let mockUser;
const branches = [
    { id: 'branch-1', name: 'Centro' },
    { id: 'branch-2', name: 'Norte' },
];

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/components/ui/card', () => {
    const React = require('react');
    return {
        Card: ({ children, ...props }) => React.createElement('section', props, children),
        CardContent: ({ children, ...props }) => React.createElement('div', props, children),
    };
});
jest.mock('@/components/ui/button', () => {
    const React = require('react');
    return { Button: ({ children, ...props }) => React.createElement('button', props, children) };
});
jest.mock('@/components/ui/tabs', () => {
    const React = require('react');
    const TabsContext = React.createContext(() => {});
    return {
        Tabs: ({ value, onValueChange, children }) => React.createElement(
            TabsContext.Provider, { value: onValueChange },
            React.createElement('div', { 'data-current-period': value }, children)
        ),
        TabsList: ({ children }) => React.createElement('div', null, children),
        TabsTrigger: ({ value, children, ...props }) => {
            const onValueChange = React.useContext(TabsContext);
            return React.createElement('button', {
                ...props,
                type: 'button',
                onClick: () => onValueChange(value),
            }, children);
        },
    };
});
jest.mock('recharts', () => {
    const React = require('react');
    const Chart = ({ children }) => React.createElement('div', null, children);
    const Shape = () => null;
    return {
        BarChart: Chart, Bar: Shape, XAxis: Shape, YAxis: Shape, Tooltip: Shape,
        ResponsiveContainer: Chart, PieChart: Chart, Pie: Chart, Cell: Shape,
        CartesianGrid: Shape, Legend: Shape,
    };
});
jest.mock('lucide-react', () => {
    const React = require('react');
    const Icon = () => React.createElement('span');
    return { BarChart3: Icon, TrendingUp: Icon, ShoppingCart: Icon, Ban: Icon, Printer: Icon, FileDown: Icon };
});

global.IS_REACT_ACT_ENVIRONMENT = true;

const report = (total) => ({
    period: 'day',
    total_sales: total,
    orders_count: total,
    avg_ticket: total,
    cancelled_orders: 0,
    sales_by_day: [],
    by_method: [],
    top_products: [],
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
    act(() => root.render(<Reportes />));
    return { host, root };
}
function branchSelector(host) { return host.querySelector('[data-testid="reportes-branch-context"]'); }
function exportButton(host) { return Array.from(host.querySelectorAll('button')).find((button) => button.textContent.includes('Exportar CSV')); }
function reportCall(config) {
    return api.get.mock.calls.find(([path, options]) => path === '/reports/sales' && options?.params && config(options.params));
}

beforeEach(() => {
    mounted = [];
    mockUser = { id: 'owner-1', restaurant_id: 'restaurant-1', role: 'admin' };
    api.get.mockReset().mockImplementation((path) => {
        if (path === '/branches') return Promise.resolve({ data: branches });
        return Promise.resolve({ data: report(42) });
    });
});

afterEach(async () => {
    for (const { host, root } of mounted) {
        await act(async () => root.unmount());
        host.remove();
    }
    document.body.innerHTML = '';
    jest.clearAllMocks();
});

test('owner defaults to all branches even when the catalog contains one branch', async () => {
    api.get.mockImplementation((path) => path === '/branches'
        ? Promise.resolve({ data: [{ id: 'only-branch', name: 'Única' }] })
        : Promise.resolve({ data: report(42) }));
    const { host } = mount();
    await flush();

    expect(branchSelector(host)?.value).toBe('all');
    expect(branchSelector(host)).not.toBeNull();
    expect(Array.from(branchSelector(host).options).map((option) => option.value)).toEqual([
        'all', 'branch:only-branch', 'legacy',
    ]);
    expect(api.get).toHaveBeenCalledWith('/reports/sales', { params: { period: 'day' } });
    expect(host.textContent).toContain('Todas las sucursales');
    expect(host.textContent).toContain('Este reporte consolida las ventas de todas las sucursales.');
});

test('registered branch and legacy contexts send exact filters while retaining the period', async () => {
    const { host } = mount();
    await flush();

    expect(branchSelector(host)).not.toBeNull();
    await change(branchSelector(host), 'branch:branch-2');
    await flush();
    expect(reportCall((params) => params.period === 'day' && params.branch_id === 'branch-2')).toBeDefined();
    expect(host.textContent).toContain('Norte');
    expect(host.textContent).toContain('Este reporte incluye las ventas de Norte.');

    await change(branchSelector(host), 'legacy');
    await flush();
    expect(reportCall((params) => params.period === 'day' && params.legacy_only === true
        && !Object.prototype.hasOwnProperty.call(params, 'branch_id'))).toBeDefined();
    expect(branchSelector(host).value).toBe('legacy');
    expect(host.textContent).toContain('Registros históricos sin sucursal');
});

test('old scope and period responses cannot replace current data or remain exportable', async () => {
    let resolveAll;
    let resolveBranchDay;
    api.get.mockImplementation((path, options = {}) => {
        if (path === '/branches') return Promise.resolve({ data: branches });
        const { period, branch_id: branchId } = options.params || {};
        if (period === 'day' && !branchId) return new Promise((resolve) => { resolveAll = resolve; });
        if (period === 'day' && branchId === 'branch-1') {
            return new Promise((resolve) => { resolveBranchDay = resolve; });
        }
        if (period === 'week' && branchId === 'branch-1') return Promise.resolve({ data: { ...report(30), period: 'week' } });
        return Promise.resolve({ data: report(100) });
    });
    const { host } = mount();
    await flush();
    expect(resolveAll).toBeDefined();
    expect(exportButton(host)?.disabled).toBe(true);

    expect(branchSelector(host)).not.toBeNull();
    await change(branchSelector(host), 'branch:branch-1');
    await flush();
    expect(resolveBranchDay).toBeDefined();
    expect(exportButton(host)?.disabled).toBe(true);
    expect(host.querySelector('[data-testid="reportes-total-ventas"]')).toBeNull();

    await act(async () => host.querySelector('[data-testid="reportes-periodo-week"]').click());
    await flush();
    expect(exportButton(host)?.disabled).toBe(false);
    expect(host.textContent).toContain('30');
    expect(reportCall((params) => params.period === 'week' && params.branch_id === 'branch-1')).toBeDefined();

    await act(async () => resolveBranchDay({ data: report(20) }));
    await act(async () => resolveAll({ data: report(999) }));
    await flush();
    expect(host.textContent).not.toContain('999');
    expect(host.textContent).toContain('30');
    expect(host.textContent).not.toContain('20');
    expect(exportButton(host)?.disabled).toBe(false);
});

test('late branch catalog and report responses from a previous auth identity are ignored', async () => {
    let resolveOldBranches;
    let resolveOldReport;
    api.get.mockImplementation((path) => {
        if (path === '/branches' && mockUser.id === 'owner-1') {
            return new Promise((resolve) => { resolveOldBranches = resolve; });
        }
        if (path === '/branches') return Promise.resolve({ data: [{ id: 'branch-new', name: 'Nueva' }] });
        if (mockUser.id === 'owner-1') return new Promise((resolve) => { resolveOldReport = resolve; });
        return Promise.resolve({ data: report(7) });
    });
    const { host, root } = mount();
    await flush();
    expect(resolveOldBranches).toBeDefined();
    expect(resolveOldReport).toBeDefined();

    mockUser = { id: 'owner-2', restaurant_id: 'restaurant-2', role: 'admin' };
    await act(async () => root.render(<Reportes />));
    await flush();
    expect(Array.from(branchSelector(host).options).some((option) => option.textContent === 'Nueva')).toBe(true);
    expect(host.textContent).toContain('7');

    await act(async () => resolveOldBranches({ data: [{ id: 'branch-old', name: 'Anterior' }] }));
    await act(async () => resolveOldReport({ data: report(888) }));
    await flush();
    expect(Array.from(branchSelector(host).options).some((option) => option.textContent === 'Anterior')).toBe(false);
    expect(host.textContent).not.toContain('888');
    expect(host.textContent).toContain('7');
});

test('staff has no owner selector or catalog request', async () => {
    mockUser = { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'cajero', branch_id: 'branch-1' };
    const { host } = mount();
    await flush();

    expect(branchSelector(host)).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/branches');
    expect(api.get).toHaveBeenCalledWith('/reports/sales', { params: { period: 'day' } });
});

test('scoped 404 fails closed and never falls back to consolidated sales', async () => {
    api.get.mockImplementation((path, options = {}) => {
        if (path === '/branches') return Promise.resolve({ data: branches });
        if (options.params?.branch_id) return Promise.reject({ response: { status: 404 } });
        return Promise.resolve({ data: report(77) });
    });
    const { host } = mount();
    await flush();
    expect(branchSelector(host)).not.toBeNull();
    await change(branchSelector(host), 'branch:branch-1');
    await flush();

    expect(host.textContent).toContain('No se puede consultar esta sucursal');
    expect(host.textContent).not.toContain('77');
    const calls = api.get.mock.calls.filter(([path]) => path === '/reports/sales');
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual({ params: { period: 'day', branch_id: 'branch-1' } });
});

test('catalog failure exposes no unverified branch option but keeps deliberate all and legacy modes', async () => {
    api.get.mockImplementation((path) => path === '/branches'
        ? Promise.reject(new Error('unavailable'))
        : Promise.resolve({ data: report(42) }));
    const { host } = mount();
    await flush();

    expect(host.textContent).toContain('No se pudieron cargar las sucursales');
    expect(branchSelector(host)).not.toBeNull();
    expect(Array.from(branchSelector(host).options).map((option) => option.value)).toEqual(['all', 'legacy']);
    expect(api.get).toHaveBeenCalledWith('/reports/sales', { params: { period: 'day' } });
});
