/**
 * Paridad del piso del Salón con el prototipo final (Slice 1):
 * - S1-1: piso agrupado por zona, con encabezado "N mesas" por sección.
 * - S1-2: línea "N asientos" en la tarjeta de mesa y capacidad sumada en el grupo.
 * - S1-3: total "S/ X en mesas" con los saldos pendientes del piso.
 * - S1-4: orden por prioridad con desempate por número de ancla.
 *
 * Sigue el patrón de mocks de SalonTableGroups.test.js: `usePolling` devuelve
 * filas mutables para poder cambiar el piso entre tests sin re-montar mocks.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const joinedGroup = { id: 'group-1', name: 'Mesas 1 + 2', anchor_table_id: 'table-1', table_ids: ['table-1', 'table-2'] };

const table = (id, number, area, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area, capacity: 4, status: 'disponible',
    branch_id: 'branch-1', active_order: null, group: null, group_id: null, qr_status: 'active', ...extra,
});

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();

const order = (id, total, extra = {}) => ({
    id, order_number: Number(String(id).replace(/\D/g, '')) || 1, status: 'en_preparacion',
    source: 'staff', total, amount_paid: 0, created_at: minutesAgo(5), items: [], ...extra,
});

let mockTables = [];
let mockOrders = [];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }),
}));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(fetcher.toString())
        ? { data: mockTables, refetch: jest.fn() }
        : { data: mockOrders, refetch: jest.fn() }),
}));

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Salon />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return { container, root };
}

async function click(element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function type(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

const zoneIds = (container) => Array.from(container.querySelectorAll('[data-testid^="salon-zona-"]'))
    .map((section) => section.getAttribute('data-testid'));

const floorOrder = (container) => Array.from(container.querySelectorAll('[data-floor-state]'))
    .map((card) => card.getAttribute('data-testid'));

describe('Salón · piso por zonas (S1-1)', () => {
    let container;
    let root;

    beforeEach(() => {
        window.localStorage.clear();
        mockTables = [];
        mockOrders = [];
        api.get.mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('groups the visible units into one section per zone, with its table count', async () => {
        mockTables = [
            table('table-1', 1, 'Salón'),
            table('table-2', 2, 'Salón', {
                status: 'ocupada',
                active_order: order('o2', 20, { status: 'listo' }),
            }),
            table('table-3', 3, 'Terraza'),
        ];
        ({ container, root } = await renderPage());

        // Una sección por zona, en el orden del piso, y solo con mesas visibles.
        expect(zoneIds(container)).toEqual(['salon-zona-Salón', 'salon-zona-Terraza']);
        const salon = container.querySelector('[data-testid="salon-zona-Salón"]');
        const terraza = container.querySelector('[data-testid="salon-zona-Terraza"]');
        expect(salon.querySelector('h2').textContent).toBe('Salón');
        expect(salon.textContent).toContain('2 mesas');
        expect(salon.querySelector('[data-testid="mesa-card-1"]')).not.toBeNull();
        expect(salon.querySelector('[data-testid="mesa-card-2"]')).not.toBeNull();
        expect(salon.querySelector('[data-testid="mesa-card-3"]')).toBeNull();
        expect(terraza.textContent).toContain('1 mesa');
        expect(terraza.querySelector('[data-testid="mesa-card-3"]')).not.toBeNull();
    });

    it('drops the empty sections when a zone filter is chosen', async () => {
        mockTables = [
            table('table-1', 1, 'Salón'),
            table('table-2', 2, 'Salón'),
            table('table-3', 3, 'Terraza'),
        ];
        ({ container, root } = await renderPage());

        await click(container.querySelector('[data-testid="mesas-area-Terraza"]'));

        expect(zoneIds(container)).toEqual(['salon-zona-Terraza']);
        expect(container.querySelector('[data-testid="mesa-card-1"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-card-3"]')).not.toBeNull();

        await click(container.querySelector('[data-testid="mesas-area-todas"]'));
        expect(zoneIds(container)).toEqual(['salon-zona-Salón', 'salon-zona-Terraza']);
    });

    it('only renders zones that keep a unit after the search and state filters', async () => {
        mockTables = [
            table('table-1', 1, 'Salón'),
            table('table-2', 2, 'Salón', {
                status: 'ocupada',
                active_order: order('o2', 20, { status: 'listo' }),
            }),
            table('table-3', 3, 'Terraza'),
        ];
        ({ container, root } = await renderPage());

        await type(container.querySelector('[data-testid="salon-search-input"]'), '2');
        expect(zoneIds(container)).toEqual(['salon-zona-Salón']);
        expect(floorOrder(container)).toEqual(['mesa-card-2']);

        await type(container.querySelector('[data-testid="salon-search-input"]'), '');
        await click(container.querySelector('[data-testid="salon-filtro-listo"]'));
        expect(zoneIds(container)).toEqual(['salon-zona-Salón']);
        expect(floorOrder(container)).toEqual(['mesa-card-2']);
    });
});

describe('Salón · capacidad en las tarjetas (S1-2)', () => {
    let container;
    let root;

    beforeEach(() => {
        window.localStorage.clear();
        mockTables = [];
        mockOrders = [];
        api.get.mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('shows the seats line on a table card', async () => {
        mockTables = [table('table-3', 3, 'Salón', { capacity: 4 })];
        ({ container, root } = await renderPage());

        const seats = container.querySelector('[data-testid="mesa-card-asientos-3"]');
        expect(seats).not.toBeNull();
        expect(seats.textContent).toBe('4 asientos');
    });

    it('leaves the seats line out when the table has no capacity data', async () => {
        mockTables = [table('table-4', 4, 'Salón', { capacity: null })];
        ({ container, root } = await renderPage());

        expect(container.querySelector('[data-testid="mesa-card-asientos-4"]')).toBeNull();
    });

    it('sums the seats of the members in a joined group', async () => {
        mockTables = [
            table('table-1', 1, 'Salón', {
                capacity: 4, status: 'ocupada', group: joinedGroup, group_id: 'group-1',
                active_order: order('o1', 30),
            }),
            table('table-2', 2, 'Salón', { capacity: 6, status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
        ];
        ({ container, root } = await renderPage());

        const seats = container.querySelector('[data-testid="mesa-grupo-asientos"]');
        expect(seats).not.toBeNull();
        expect(seats.textContent).toBe('10 asientos');
    });

    it('leaves the group seats line out when a member has no capacity data', async () => {
        mockTables = [
            table('table-1', 1, 'Salón', {
                capacity: 4, status: 'ocupada', group: joinedGroup, group_id: 'group-1',
                active_order: order('o1', 30),
            }),
            table('table-2', 2, 'Salón', { capacity: null, status: 'ocupada', group: joinedGroup, group_id: 'group-1' }),
        ];
        ({ container, root } = await renderPage());

        expect(container.querySelector('[data-testid="mesa-grupo-asientos"]')).toBeNull();
    });
});

describe('Salón · consumo del piso (S1-3)', () => {
    let container;
    let root;

    beforeEach(() => {
        window.localStorage.clear();
        mockTables = [];
        mockOrders = [];
        api.get.mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('shows the pending balance of the floor, groups included, in the header', async () => {
        mockTables = [
            table('table-1', 1, 'Salón', {
                status: 'ocupada', group: joinedGroup, group_id: 'group-1', active_order: order('o1', 30),
            }),
            table('table-2', 2, 'Salón', {
                status: 'ocupada', group: joinedGroup, group_id: 'group-1', active_order: order('o2', 18),
            }),
            table('table-3', 3, 'Terraza'),
        ];
        ({ container, root } = await renderPage());

        const total = container.querySelector('[data-testid="salon-total-en-mesas"]');
        expect(total).not.toBeNull();
        expect(total.textContent).toBe('S/ 48.00 en mesas');
        expect(container.querySelector('[data-testid="salon-resumen"]').textContent)
            .toContain('S/ 48.00 en mesas');
    });
});

describe('Salón · orden por prioridad (S1-4)', () => {
    let container;
    let root;

    beforeEach(() => {
        window.localStorage.clear();
        mockTables = [];
        mockOrders = [];
        api.get.mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('breaks priority ties by anchor number', async () => {
        window.localStorage.setItem('salon-orden:staff-1', 'prioridad');
        mockTables = [
            table('table-1', 1, 'Salón'),
            table('table-9', 9, 'Salón', {
                status: 'ocupada',
                active_order: order('o9', 20, { status: 'listo', created_at: minutesAgo(10) }),
            }),
            table('table-4', 4, 'Salón', {
                status: 'ocupada',
                active_order: order('o4', 20, { status: 'listo', created_at: minutesAgo(10) }),
            }),
        ];
        ({ container, root } = await renderPage());

        // Ambos "listo" llevan los mismos minutos: primero el ancla 4.
        expect(floorOrder(container)).toEqual(['mesa-card-4', 'mesa-card-9', 'mesa-card-1']);
        expect(container.querySelector('[data-testid="salon-orden"]').textContent).toContain('Prioridad');
    });
});
