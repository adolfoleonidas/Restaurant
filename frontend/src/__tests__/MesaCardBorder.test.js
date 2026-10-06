/**
 * Una tarjeta de mesa tiene un solo contorno.
 *
 * Antes, el aviso de atención y la selección sumaban un `ring` al `border`: en
 * pantalla se veían dos líneas, y con `ring-offset` quedaba además un hueco
 * entre ellas. El énfasis ahora es el mismo borde, más grueso.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

// `var` a propósito: las fábricas de jest.mock se elevan sobre las constantes.
var mockTables = [
    // Se puede servir: reclama atención.
    {
        id: 't1', number: 1, name: 'Mesa 1', status: 'ocupada', capacity: 4, area: 'Salon',
        active_attention_id: null, qr_status: 'active',
        active_order: { id: 'o1', order_number: 11, status: 'listo', source: 'staff', total: 30, created_at: new Date().toISOString() },
    },
    // Pidió la cuenta: también reclama atención.
    {
        id: 't2', number: 2, name: 'Mesa 2', status: 'esperando_pago', capacity: 4, area: 'Salon',
        active_attention_id: null, qr_status: 'active',
        active_order: { id: 'o2', order_number: 12, status: 'pendiente_pago', source: 'staff', total: 45, created_at: new Date().toISOString() },
    },
];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = String(fetcher);
        if (src.includes("'/tables'")) return { data: mockTables, refetch: jest.fn() };
        if (src.includes("'/orders'")) return { data: [], refetch: jest.fn() };
        return { data: null, refetch: jest.fn() };
    },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Salon />); await Promise.resolve(); await Promise.resolve(); });
    return { container, root };
}

describe('contorno de la tarjeta de mesa', () => {
    let container;
    let root;

    beforeEach(() => {
        api.get.mockReset().mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
    });

    it('no suma un anillo cuando la mesa reclama atención', async () => {
        ({ container, root } = await renderPage());
        for (const id of ['mesa-card-1', 'mesa-card-2']) {
            const card = container.querySelector(`[data-testid="${id}"]`);
            expect(card).not.toBeNull();
            expect(card.className).not.toMatch(/\bring-/);
            // El énfasis vive en el propio borde.
            expect(card.style.borderWidth).toBe('3px');
        }
    });

    it('deja el borde normal cuando la mesa no reclama nada', async () => {
        mockTables = [{
            id: 't3', number: 3, name: 'Mesa 3', status: 'disponible', capacity: 4, area: 'Salon',
            active_attention_id: null, qr_status: 'active', active_order: null,
        }];
        ({ container, root } = await renderPage());
        const card = container.querySelector('[data-testid="mesa-card-3"]');
        expect(card).not.toBeNull();
        expect(card.className).not.toMatch(/\bring-/);
        // Un solo contorno, y fino: el normal de la tarjeta.
        expect(card.style.borderWidth).toBe('2px');
    });
});
