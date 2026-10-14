/**
 * Lo que hay arriba de la lista de mesas, plegado.
 *
 * En el teléfono del mozo el título, el resumen, el buscador, tres botones y la fila
 * de filtros ocupaban ~350 px de una pantalla de 689: se veía UNA fila de mesas y
 * había que desplazarse para ver el salón. El buscador, "Unir mesas" y los filtros
 * arrancan plegados; las dos acciones que se usan todo el tiempo (Nuevo pedido y
 * Cocina) se quedan a la vista. La elección se recuerda por dispositivo.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

/** Dos mesas ocupadas de mentira, para que el piso tenga algo que mostrar. */
const tables = [
    { id: 'table-1', number: 1, name: 'Mesa 1', area: 'Salón', capacity: 4, status: 'disponible', active_order: null, active_attention_id: null, group: null, branch_id: 'branch-1' },
    { id: 'table-2', number: 2, name: 'Mesa 2', area: 'Salón', capacity: 4, status: 'disponible', active_order: null, active_attention_id: null, group: null, branch_id: 'branch-1' },
];

jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(fetcher.toString())
        ? { data: tables, refetch: jest.fn() }
        : { data: [], refetch: jest.fn() }),
}));

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

const click = async (el) => { await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };
const q = (id) => document.body.querySelector(`[data-testid="${id}"]`);

describe('arriba de la lista de mesas', () => {
    let container;
    let root;

    beforeEach(() => {
        window.localStorage.removeItem('salon_filtros');
        api.get.mockReset();
        api.get.mockImplementation((url) => Promise.resolve({ data: url === '/branches' ? [] : null }));
    });

    afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ''; });

    it('arranca plegado: las mesas primero', async () => {
        ({ container, root } = await renderPage());

        expect(q('salon-search-input')).toBeNull();
        expect(q('salon-filtros')).toBeNull();
        // Lo que se usa durante el servicio queda a la vista: unir mesas, nuevo
        // pedido y cocina. Lo que se pliega es buscar y filtrar.
        expect(q('salon-unir-mesas')).not.toBeNull();
        expect(q('salon-nuevo-pedido')).not.toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-1"]')).not.toBeNull();
    });

    it('el botón abre y cierra solo lo que se pliega', async () => {
        ({ container, root } = await renderPage());
        const toggle = q('salon-toggle-filtros');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        await click(toggle);
        expect(q('salon-search-input')).not.toBeNull();
        expect(q('salon-filtros')).not.toBeNull();
        expect(q('salon-toggle-filtros').getAttribute('aria-expanded')).toBe('true');

        await click(q('salon-toggle-filtros'));
        expect(q('salon-search-input')).toBeNull();
        // Unir mesas no se va con ellos.
        expect(q('salon-unir-mesas')).not.toBeNull();
    });

    it('recuerda la elección del dispositivo', async () => {
        ({ container, root } = await renderPage());
        await click(q('salon-toggle-filtros'));
        expect(window.localStorage.getItem('salon_filtros')).toBe('1');
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';

        // Vuelve a entrar: quien filtra siempre no tiene que abrirlos otra vez.
        ({ container, root } = await renderPage());
        expect(q('salon-search-input')).not.toBeNull();
        expect(q('salon-toggle-filtros').getAttribute('aria-expanded')).toBe('true');
    });
});
