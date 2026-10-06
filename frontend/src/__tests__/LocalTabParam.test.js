import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Local from '@/pages/Local';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockSearchParams = new URLSearchParams('tab=mesas');

jest.mock('react-router-dom', () => ({ useSearchParams: () => [mockSearchParams] }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const tables = [{ id: 'table-a', name: 'Mesa A', number: 1, area: 'Salón', capacity: 4, status: 'disponible', branch_id: 'branch-a' }];

describe('local tab from the url', () => {
    let host;
    let root;

    beforeEach(async () => {
        api.get.mockReset().mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((t) => ({ ...t }))
                : path === '/zones' ? [{ id: 'zone-a', name: 'Salón' }]
                    : path === '/branches' ? [{ id: 'branch-a', name: 'Centro' }] : null,
        }));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => { root.render(<Local />); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    it('opens straight on the tables tab so the branchless advisory is actionable', () => {
        // El aviso del salón manda a /local?tab=mesas: tiene que caer en Mesas,
        // no en Sucursales, para poder asignar la sucursal sin buscar la pestaña.
        expect(host.querySelector('[data-testid="mesa-config-nueva"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="mesa-config-row-table-a"]')).not.toBeNull();
    });
});
