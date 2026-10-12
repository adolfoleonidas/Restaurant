import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Usuarios from '@/pages/Usuarios';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1', role: 'admin' } }) }));

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
let view;

async function openCreateForm() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    view = { host, root };
    await act(async () => root.render(<Usuarios />));
    await flush();
    await act(async () => document.body.querySelector('[data-testid="usuario-nuevo-button"]').click());
    await flush();
}

afterEach(async () => {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
    jest.clearAllMocks();
});

beforeEach(() => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/users' ? [] : [{ id: 'b1', name: 'Centro' }] }));
});

describe('user create form validation', () => {
    it('asks for at least 8 characters up front', async () => {
        await openCreateForm();
        const password = document.body.querySelector('[data-testid="usuario-form-pass"]');
        expect(password.getAttribute('minlength')).toBe('8');
        expect(document.body.textContent).toContain('Mínimo 8 caracteres');
    });

    it('shows a 422 as a readable sentence and keeps the screen alive', async () => {
        api.post.mockRejectedValue({
            response: {
                status: 422,
                data: { detail: [{ type: 'string_too_short', loc: ['body', 'password'], msg: 'x', ctx: { min_length: 8 } }] },
            },
        });
        await openCreateForm();
        await act(async () => document.body.querySelector('[data-testid="usuario-form-save"]').click());
        await flush();
        expect(toast.error).toHaveBeenCalledWith('Contraseña: debe tener al menos 8 caracteres.');
        expect(document.body.querySelector('[data-testid="usuario-form-pass"]')).not.toBeNull();
    });
});
