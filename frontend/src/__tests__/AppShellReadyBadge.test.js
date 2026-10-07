/**
 * Badge de platos listos en la navegación (pendiente A).
 *
 * Mismo criterio y misma fuente que el resumen del Salón ("Listos: N"): items
 * con estado `listo` (sumando cantidades) en los pedidos activos. Va junto al
 * ítem de Salón y se oculta en 0.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockRole = 'mozo';
let mockOrders = [];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'staff-1', role: mockRole, full_name: 'Ana', restaurant_id: 'r1' }, logout: jest.fn() }),
}));
jest.mock('react-router-dom', () => ({
    NavLink: ({ children, className, ...rest }) => (
        <a {...rest} className={typeof className === 'function' ? className({ isActive: false }) : className}>{children}</a>
    ),
    Outlet: () => <div data-testid="outlet" />,
    useNavigate: () => jest.fn(),
}));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (fetcher.toString().includes("api.get('/orders'")
        ? { data: mockOrders, refetch: jest.fn() }
        : { data: null, refetch: jest.fn() }),
}));

async function renderShell() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<AppShell />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return { host, root };
}

describe('badge de platos listos en la nav', () => {
    let host;
    let root;

    beforeEach(() => {
        mockRole = 'mozo';
        mockOrders = [];
        api.get.mockReset().mockImplementation(() => Promise.resolve({ data: { name: 'Resto' } }));
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        host = null;
        document.body.innerHTML = '';
    });

    it('suma los platos listos y lo muestra en Salón (sidebar y barra inferior)', async () => {
        mockOrders = [
            { id: 'o1', items: [{ id: 'i1', status: 'listo', quantity: 2 }, { id: 'i2', status: 'pendiente', quantity: 5 }] },
            { id: 'o2', items: [{ id: 'i3', status: 'listo', quantity: 1 }] },
        ];
        ({ host, root } = await renderShell());

        // La métrica vive en el ítem de Salón, como el #bReady del prototipo.
        const sidebarBadge = host.querySelector('[data-testid="nav-salon"] [data-testid="nav-ready-badge"]');
        expect(sidebarBadge).not.toBeNull();
        expect(sidebarBadge.textContent).toBe('3');
        const bottomBadge = host.querySelector('[data-testid="bottom-nav-salon"] [data-testid="bottom-nav-ready-badge"]');
        expect(bottomBadge).not.toBeNull();
        expect(bottomBadge.textContent).toBe('3');
    });

    it('se oculta cuando no hay platos listos', async () => {
        mockOrders = [{ id: 'o1', items: [{ id: 'i1', status: 'en_preparacion', quantity: 2 }] }];
        ({ host, root } = await renderShell());

        expect(host.querySelector('[data-testid="nav-ready-badge"]')).toBeNull();
        expect(host.querySelector('[data-testid="bottom-nav-ready-badge"]')).toBeNull();
    });

    it('no aparece para roles sin Salón (cocina)', async () => {
        mockRole = 'cocina';
        mockOrders = [{ id: 'o1', items: [{ id: 'i1', status: 'listo', quantity: 4 }] }];
        ({ host, root } = await renderShell());

        expect(host.querySelector('[data-testid="nav-salon"]')).toBeNull();
        expect(host.querySelector('[data-testid="nav-ready-badge"]')).toBeNull();
        expect(host.querySelector('[data-testid="bottom-nav-ready-badge"]')).toBeNull();
    });
});
