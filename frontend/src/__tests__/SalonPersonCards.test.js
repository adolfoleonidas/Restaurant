/**
 * Las tarjetas de persona de la hoja, tal como las pidió el dueño:
 *
 *   - cada tarjeta muestra TRES líneas y ofrece el resto a un toque (con treinta
 *     pedidos en una mesa, la tarjeta se volvía una pared de texto),
 *   - lo último pedido queda arriba,
 *   - y las tarjetas van de la persona más reciente a la más antigua, pero el número
 *     de cada una sigue el orden de los pedidos: la primera persona es la 1, con
 *     nombre ("1. Alexis") o sin él ("Persona 1").
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

const mockTables = [];
const mockOrders = [];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(fetcher.toString())
        ? { data: mockTables, refetch: jest.fn() }
        : { data: mockOrders, refetch: jest.fn() }),
}));

const table = {
    id: 'table-1', number: 1, name: 'Mesa 1', area: 'Salón', capacity: 4,
    status: 'ocupada', active_attention_id: 'att-1', branch_id: 'branch-1',
    active_order: { id: 'order-1', status: 'en_preparacion' }, group: null,
};

/** Una cuenta con `lines` líneas, en el orden en que se pidieron. */
const account = (id, number, name, lines) => ({
    id,
    order_number: number,
    table_id: 'table-1',
    status: 'en_preparacion',
    order_type: 'mesa',
    customer_name: name || null,
    total: lines * 10,
    amount_paid: 0,
    source: 'staff',
    created_at: new Date().toISOString(),
    attention_id: 'att-1',
    attention_state: 'open',
    items: Array.from({ length: lines }, (_, index) => ({
        id: `${id}-item-${index + 1}`,
        product_name: `${id} plato ${index + 1}`,
        quantity: 1,
        unit_price: 10,
        subtotal: 10,
        status: 'pendiente',
    })),
});

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

const click = async (el) => { await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };

// order-1: 5 líneas, sin nombre · order-2: 3 líneas, sin nombre · order-3: 4, "Alexis"
const o1 = account('order-1', 11, null, 5);
const o2 = account('order-2', 12, null, 3);
const o3 = account('order-3', 13, 'Alexis', 4);

describe('tarjetas de persona en la hoja de mesa', () => {
    let container;
    let root;

    beforeEach(async () => {
        api.get.mockReset();
        mockTables.splice(0, mockTables.length, table);
        mockOrders.splice(0, mockOrders.length, o1, o2, o3);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url.startsWith('/orders/')) {
                const id = url.split('/')[2];
                return Promise.resolve({ data: mockOrders.find((o) => o.id === id) || o1 });
            }
            return Promise.resolve({ data: mockOrders });
        });
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
    });

    afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ''; });

    const sheet = () => document.body.querySelector('[data-testid="mesa-sheet"]');
    const card = (number) => sheet().querySelector(`[data-testid="mesa-sheet-pedido-${number}"]`);
    /** Las tarjetas, en el orden en que se ven. */
    const cardsOnScreen = () => [...sheet().querySelectorAll('[data-testid]')]
        .map((node) => node.getAttribute('data-testid'))
        .filter((id) => /^mesa-sheet-pedido-\d+$/.test(id));
    /** Las líneas de una tarjeta, en el orden en que se ven. */
    const linesOf = (number) => [...card(number).querySelector('[data-testid$="-items"]').children]
        .map((node) => node.textContent);

    it('van de la persona más reciente a la más antigua', () => {
        expect(cardsOnScreen()).toEqual([
            'mesa-sheet-pedido-13', 'mesa-sheet-pedido-12', 'mesa-sheet-pedido-11',
        ]);
    });

    it('el número sigue el orden de los pedidos, con nombre o sin él', () => {
        // La tercera persona sigue siendo la 3 aunque esté primera en pantalla.
        expect(card(13).textContent).toContain('3. Alexis');
        expect(card(12).textContent).toContain('Persona 2');
        expect(card(11).textContent).toContain('Persona 1');
    });

    it('muestra tres líneas y ofrece el resto a un toque', async () => {
        expect(linesOf(11)).toHaveLength(3);
        const more = card(11).querySelector('[data-testid="mesa-sheet-ver-mas"]');
        expect(more.textContent).toContain('2 restantes');
        await click(more);
        expect(linesOf(11)).toHaveLength(5);
        expect(card(11).querySelector('[data-testid="mesa-sheet-ver-mas"]').textContent).toBe('Ver menos');
    });

    it('lo último pedido queda arriba', () => {
        expect(linesOf(11)[0]).toContain('plato 5');
        expect(linesOf(11)[2]).toContain('plato 3');
    });

    it('con tres líneas no ofrece nada de más, y con cuatro ofrece una', () => {
        // La cuenta activa usa el prefijo base; las demás, el suyo.
        expect(card(12).querySelector('[data-testid="mesa-sheet-pedido-12-ver-mas"]')).toBeNull();
        expect(card(13).querySelector('[data-testid="mesa-sheet-pedido-13-ver-mas"]').textContent).toBe('Ver 1 más');
    });
});
