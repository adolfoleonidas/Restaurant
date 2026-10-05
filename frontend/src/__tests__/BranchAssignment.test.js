import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Mesas from '@/pages/MesasAdmin';
import Usuarios from '@/pages/Usuarios';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1', role: 'admin' } }) }));

const branches = [{ id: 'branch-a', name: 'Centro' }, { id: 'branch-b', name: 'Norte' }];
const users = [{ id: 'user-a', email: 'staff@example.test', full_name: 'Staff', role: 'mozo', phone: '', status: 'active', branch_id: 'branch-a', functions: ['atencion'] }];
const tables = [{ id: 'table-a', name: 'Mesa A', number: 1, area: 'Salón', capacity: 4, status: 'disponible', branch_id: 'branch-a', qr_status: 'active' }];
const mounted = [];

async function render(Component) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Component />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const view = { host, root };
    mounted.push(view);
    return view;
}

async function click(id) {
    const node = document.body.querySelector(`[data-testid="${id}"]`);
    await act(async () => node.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function clickNode(node) {
    await act(async () => node.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function cleanup(view) {
    await act(async () => view.root.unmount());
    view.host.remove();
    mounted.splice(mounted.indexOf(view), 1);
    document.body.innerHTML = '';
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

afterEach(async () => {
    for (const view of [...mounted]) await cleanup(view);
    jest.clearAllMocks();
    document.body.innerHTML = '';
});

describe('user branch assignment controls', () => {
    beforeEach(() => {
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/users' ? users.map((u) => ({ ...u })) : branches }));
        api.post.mockResolvedValue({ data: { id: 'user-new' } });
        api.patch.mockResolvedValue({ data: { id: 'user-a' } });
    });

    it('requires an explicit branch choice on user create and never auto-selects a sole branch', async () => {
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/users' ? [] : [branches[0]] }));
        const view = await render(Usuarios);
        await click('usuario-nuevo-button');
        const branch = document.body.querySelector('[data-testid="usuario-form-branch"]');
        expect(branch).not.toBeNull();
        expect(branch.value).toBe('');
        await act(async () => {
            branch.value = 'branch-a';
            branch.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await click('usuario-form-save');
        expect(api.post).toHaveBeenCalledWith('/users', expect.objectContaining({ branch_id: 'branch-a' }));
        await cleanup(view);
    });

    it('shows an existing assignment and includes a changed branch only after explicit selection', async () => {
        const view = await render(Usuarios);
        await clickNode(document.body.querySelector('[aria-label="Editar Staff"]'));
        const branch = document.body.querySelector('[data-testid="usuario-form-branch"]');
        expect(branch.value).toBe('branch-a');
        expect(document.body.querySelector('label[for="usuario-form-branch"]')).not.toBeNull();
        expect(Array.from(branch.options).map((option) => option.value)).not.toContain('');
        await act(async () => {
            branch.value = 'branch-b';
            branch.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await click('usuario-form-save');
        expect(api.patch).toHaveBeenCalledWith('/users/user-a', expect.objectContaining({ branch_id: 'branch-b', role: 'mozo' }));
        expect(api.patch.mock.calls[0][1].branch_id).toBe('branch-b');
        await cleanup(view);
    });

    it('omits branch_id on an unchanged assigned user while preserving role and functions without resending a password', async () => {
        const view = await render(Usuarios);
        await clickNode(document.body.querySelector('[aria-label="Editar Staff"]'));
        await click('usuario-form-save');
        const payload = api.patch.mock.calls[0][1];
        expect(payload).toEqual(expect.objectContaining({ role: 'mozo', functions: ['atencion'] }));
        expect(payload).not.toHaveProperty('branch_id');
        expect(payload).not.toHaveProperty('password');
        await cleanup(view);
    });

    it('omits branch_id when creating an unassigned user and preserves role, functions, and password omission', async () => {
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/users' ? [] : branches }));
        const view = await render(Usuarios);
        await click('usuario-nuevo-button');
        await click('usuario-form-save');
        expect(api.post).toHaveBeenCalledWith('/users', expect.any(Object));
        expect(api.post.mock.calls[0][1]).not.toHaveProperty('branch_id');
        await cleanup(view);
    });

    it('keeps ordinary edits available during deferred and empty branch catalogs', async () => {
        const pendingBranches = deferred();
        api.get.mockImplementation((path) => path === '/branches' ? pendingBranches.promise
            : Promise.resolve({ data: path === '/users' ? users.map((u) => ({ ...u })) : [] }));
        const view = await render(Usuarios);
        await clickNode(document.body.querySelector('[aria-label="Editar Staff"]'));
        await click('usuario-form-save');
        expect(api.patch).toHaveBeenCalledWith('/users/user-a', expect.objectContaining({ role: 'mozo', functions: ['atencion'] }));
        expect(api.patch.mock.calls[0][1]).not.toHaveProperty('branch_id');
        expect(api.patch.mock.calls[0][1]).not.toHaveProperty('password');
        await act(async () => pendingBranches.resolve({ data: [] }));
        await clickNode(document.body.querySelector('[aria-label="Editar Staff"]'));
        expect(document.body.querySelector('[data-testid="usuario-form-branch"]').disabled).toBe(false);
        expect(document.body.textContent).toContain('No hay sucursales configuradas');
        await cleanup(view);
    });

    it('offers catalog retry after a load error and preserves the existing assignment', async () => {
        let branchLoadCount = 0;
        const pendingRetry = deferred();
        api.get.mockImplementation((path) => path === '/branches'
            ? (branchLoadCount++ === 0 ? Promise.reject(new Error('offline')) : pendingRetry.promise)
            : Promise.resolve({ data: path === '/users' ? users.map((u) => ({ ...u })) : [] }));
        const view = await render(Usuarios);
        await clickNode(document.body.querySelector('[aria-label="Editar Staff"]'));
        expect(document.body.querySelector('[data-testid="usuario-branches-retry"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="usuario-form-branch"]').disabled).toBe(true);
        await act(async () => document.body.querySelector('[data-testid="usuario-branches-retry"]').click());
        expect(document.body.querySelector('[data-testid="usuario-branches-retry"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="usuario-form-branch"]').disabled).toBe(true);
        await act(async () => pendingRetry.resolve({ data: branches }));
        const branch = document.body.querySelector('[data-testid="usuario-form-branch"]');
        expect(branch.disabled).toBe(false);
        expect(branch.value).toBe('branch-a');
        await cleanup(view);
    });

    it('prevents duplicate user saves while the request is pending', async () => {
        const pendingSave = deferred();
        api.patch.mockReturnValue(pendingSave.promise);
        const view = await render(Usuarios);
        await clickNode(document.body.querySelector('[aria-label="Editar Staff"]'));
        await click('usuario-form-save');
        await click('usuario-form-save');
        expect(api.patch).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector('[data-testid="usuario-form-save"]').disabled).toBe(true);
        await act(async () => pendingSave.resolve({ data: users[0] }));
        await cleanup(view);
    });
});

describe('table branch assignment controls', () => {
    beforeEach(() => {
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/tables' ? tables.map((t) => ({ ...t }))
            : path === '/zones' ? [{ id: 'zone-a', name: 'Salón' }] : path === '/branches' ? branches
                : path === '/restaurants/current' ? { name: 'Restaurant' } : null }));
        api.post.mockResolvedValue({ data: { id: 'table-new' } });
        api.patch.mockResolvedValue({ data: { id: 'table-a' } });
    });

    it('creates a table with a selected branch and leaves one-option catalogs unassigned by default', async () => {
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/tables' ? []
            : path === '/zones' ? [{ id: 'zone-a', name: 'Salón' }] : path === '/branches' ? [branches[0]]
                : path === '/restaurants/current' ? { name: 'Restaurant' } : null }));
        const view = await render(Mesas);
        await click('mesa-config-nueva');
        const branch = document.body.querySelector('[data-testid="mesa-form-branch"]');
        expect(branch).not.toBeNull();
        expect(branch.value).toBe('');
        await act(async () => {
            branch.value = 'branch-a';
            branch.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(document.body.querySelector('label[for="mesa-form-branch"]')).not.toBeNull();
        await click('mesa-form-save');
        expect(api.post).toHaveBeenCalledWith('/tables', expect.objectContaining({ branch_id: 'branch-a' }));
        await cleanup(view);
    });

    it('omits branch_id when creating an unassigned table', async () => {
        const view = await render(Mesas);
        await click('mesa-config-nueva');
        await click('mesa-form-save');
        expect(api.post).toHaveBeenCalledWith('/tables', expect.any(Object));
        expect(api.post.mock.calls[0][1]).not.toHaveProperty('branch_id');
        await cleanup(view);
    });

    it('preserves a legacy unassigned table until explicit branch selection', async () => {
        api.get.mockImplementation((path) => Promise.resolve({ data: path === '/tables' ? [{ ...tables[0], branch_id: undefined }]
            : path === '/zones' ? [{ id: 'zone-a', name: 'Salón' }] : path === '/branches' ? branches
                : path === '/restaurants/current' ? { name: 'Restaurant' } : null }));
        const view = await render(Mesas);
        await clickNode(document.body.querySelector('[aria-label="Editar Mesa A"]'));
        const branch = document.body.querySelector('[data-testid="mesa-form-branch"]');
        expect(branch.value).toBe('');
        await click('mesa-form-save');
        expect(api.patch.mock.calls[0][1]).not.toHaveProperty('branch_id');
        await cleanup(view);
    });

    it('retains the displayed branch after the server rejects reassignment and does not touch QR endpoints', async () => {
        api.patch.mockRejectedValue({ response: { data: { detail: 'La mesa está ocupada' } } });
        const view = await render(Mesas);
        await clickNode(document.body.querySelector('[aria-label="Editar Mesa A"]'));
        const branch = document.body.querySelector('[data-testid="mesa-form-branch"]');
        await act(async () => {
            branch.value = 'branch-b';
            branch.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await click('mesa-form-save');
        expect(api.patch).toHaveBeenCalledWith('/tables/table-a', expect.objectContaining({ branch_id: 'branch-b' }));
        expect(toast.error).toHaveBeenCalledWith('La mesa está ocupada');
        expect(api.post.mock.calls.every(([path]) => !/qr|release|payments|orders/.test(path))).toBe(true);
        expect(document.body.querySelector('[data-testid="mesa-config-row-table-a"]').textContent).toContain('Centro');
        await cleanup(view);
    });

    it('omits branch_id on an unchanged assigned table', async () => {
        const view = await render(Mesas);
        await clickNode(document.body.querySelector('[aria-label="Editar Mesa A"]'));
        const branch = document.body.querySelector('[data-testid="mesa-form-branch"]');
        expect(Array.from(branch.options).map((option) => option.value)).not.toContain('');
        await click('mesa-form-save');
        const payload = api.patch.mock.calls[0][1];
        expect(payload).not.toHaveProperty('branch_id');
        await cleanup(view);
    });

    it('keeps ordinary table edits available while the branch list is pending and empty', async () => {
        const pendingBranches = deferred();
        api.get.mockImplementation((path) => path === '/branches' ? pendingBranches.promise
            : Promise.resolve({ data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [{ id: 'zone-a', name: 'Salón' }]
                    : path === '/restaurants/current' ? { name: 'Restaurant' } : null }));
        const view = await render(Mesas);
        await clickNode(document.body.querySelector('[aria-label="Editar Mesa A"]'));
        expect(document.body.querySelector('[data-testid="mesa-branches-loading"]')).not.toBeNull();
        await click('mesa-form-save');
        const payload = api.patch.mock.calls[0][1];
        expect(payload).not.toHaveProperty('branch_id');
        await act(async () => pendingBranches.resolve({ data: [] }));
        await clickNode(document.body.querySelector('[aria-label="Editar Mesa A"]'));
        expect(document.body.textContent).toContain('No hay sucursales configuradas');
        expect(document.body.querySelector('[data-testid="mesa-form-branch"]').value).toBe('branch-a');
        await cleanup(view);
    });

    it('offers catalog retry for table assignment without auto-selecting on retry', async () => {
        let failing = true;
        const pendingRetry = deferred();
        api.get.mockImplementation((path) => path === '/branches'
            ? (failing ? Promise.reject(new Error('offline')) : pendingRetry.promise)
            : Promise.resolve({ data: path === '/tables' ? [] : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' } : null }));
        const view = await render(Mesas);
        await click('mesa-config-nueva');
        failing = false;
        expect(document.body.querySelector('[data-testid="mesa-branches-retry"]')).not.toBeNull();
        await act(async () => document.body.querySelector('[data-testid="mesa-branches-retry"]').click());
        expect(document.body.querySelector('[data-testid="mesa-branches-retry"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-form-branch"]').disabled).toBe(true);
        await act(async () => pendingRetry.resolve({ data: [branches[0]] }));
        const branch = document.body.querySelector('[data-testid="mesa-form-branch"]');
        expect(branch.disabled).toBe(false);
        expect(branch.value).toBe('');
        await cleanup(view);
    });

    it('prevents duplicate table saves while the request is pending', async () => {
        const pendingSave = deferred();
        api.post.mockReturnValue(pendingSave.promise);
        const view = await render(Mesas);
        await click('mesa-config-nueva');
        await click('mesa-form-save');
        await click('mesa-form-save');
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector('[data-testid="mesa-form-save"]').disabled).toBe(true);
        await act(async () => pendingSave.resolve({ data: { id: 'table-new' } }));
        await cleanup(view);
    });
});
