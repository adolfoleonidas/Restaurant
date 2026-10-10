/**
 * Compositor como el prototipo (S8, posView).
 *
 * - Franja "Para {persona} · ✎ Nombre" arriba de la carta.
 * - Móvil: FAB "Ver pedido · …" + hoja inferior del borrador (scrim, líneas
 *   con stepper y nota, nota general y envío).
 * - El contenido inline sigue montado: el e2e móvil verifica
 *   `mesa-sheet-items` visible sin abrir ninguna hoja.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { toast } from 'sonner';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: mockRole } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;
const originalConfirm = window.confirm;

const mockTables = [];
const mockOrders = [];
const mockProducts = [];
let mockRole = 'admin';
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = fetcher.toString();
        if (src.includes("api.get('/tables')")) return { data: mockTables, refetch: jest.fn() };
        if (src.includes("api.get('/products')")) return { data: mockProducts, refetch: jest.fn() };
        if (src.includes("api.get('/categories')")) return { data: [], refetch: jest.fn() };
        return { data: mockOrders, refetch: jest.fn() };
    },
}));

const baseTable = (number, extra = {}) => ({
    id: `table-${number}`, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4,
    status: 'ocupada', active_attention_id: 'att-1', branch_id: 'branch-1', active_order: null, group: null, ...extra,
});

const item = (id, name, qty, price, status, extra = {}) => ({
    id, product_id: extra.product_id || `prod-${id}`, product_name: name, quantity: qty, unit_price: price,
    subtotal: qty * price, status, notes: null, ...extra,
});

const order = (id, number, status, items, extra = {}) => ({
    id, order_number: number, table_id: 'table-1', status, order_type: 'mesa',
    total: items.reduce((s, i) => s + i.subtotal, 0), amount_paid: 0, source: 'staff',
    created_at: new Date().toISOString(), attention_id: 'att-1', attention_state: 'open',
    items, ...extra,
});

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(el) {
    await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function type(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** Abre la mesa 1. Un borrador ('nuevo' con ítems en borrador) abre la carta sola. */
async function openTableWith(accounts, tableExtra = {}) {
    mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: accounts[0].id, status: accounts[0].status }, ...tableExtra }));
    mockOrders.splice(0, mockOrders.length, ...accounts);
    api.get.mockImplementation((url) => {
        if (url === '/branches') return Promise.resolve({ data: [] });
        const match = accounts.find((o) => url === `/orders/${o.id}`);
        if (match) return Promise.resolve({ data: match });
        return Promise.resolve({ data: accounts });
    });
    const rendered = await renderPage();
    await click(rendered.container.querySelector('[data-testid="mesa-card-1"]'));
    const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
    return { ...rendered, sheet };
}

describe('compositor · paridad posView (S8)', () => {
    let container;
    let root;
    let sheet;

    beforeEach(() => {
        window.confirm = jest.fn().mockReturnValue(false);
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
        api.patch.mockResolvedValue({ data: {} });
        api.post.mockResolvedValue({ data: {} });
        mockProducts.splice(0, mockProducts.length,
            { id: 'prod-n1', name: 'Ceviche', price: 38, is_available: true, category_id: 'c1' });
        mockOrders.splice(0, mockOrders.length);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        window.confirm = originalConfirm;
        root = null;
        container = null;
        sheet = null;
        document.body.innerHTML = '';
    });

    it('muestra la franja "Para {persona}" con renombre reusando el alias existente', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([draft]));

        const bar = sheet.querySelector('[data-testid="mesa-sheet-persona"]');
        expect(bar).not.toBeNull();
        expect(bar.textContent).toContain('Para');
        expect(bar.textContent).toContain('Juan');

        await click(sheet.querySelector('[data-testid="mesa-sheet-persona-renombrar"]'));
        const input = sheet.querySelector('[data-testid="mesa-sheet-persona-nombre"]');
        expect(input).not.toBeNull();
        await type(input, 'Pedro');
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/alias', { alias: 'Pedro', shared: false });
    });

    it('confirma Vaciar, cancela sin borrar y al aceptar elimina solo borradores', async () => {
        const sent = item('sent-1', 'Sopa', 1, 12, 'pendiente');
        const draftItem = item('draft-1', 'Agua', 1, 5, 'borrador');
        const account = order('order-1', 11, 'en_preparacion', [sent, draftItem]);
        ({ container, root, sheet } = await openTableWith([account]));
        window.confirm = jest.fn().mockReturnValue(false);
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));

        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-vaciar"]'));
        expect(window.confirm).toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).not.toBeNull();

        window.confirm.mockReturnValue(true);
        api.delete.mockImplementation(async () => {
            account.items = account.items.filter((entry) => entry.id !== 'draft-1');
            return { data: {} };
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-vaciar"]'));
        expect(api.delete).toHaveBeenCalledTimes(1);
        expect(api.delete).toHaveBeenCalledWith('/orders/order-1/items/draft-1');
        expect(api.delete).not.toHaveBeenCalledWith('/orders/order-1/items/sent-1');
        expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/vaciado|eliminado/i));
        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-sent-1"]')).not.toBeNull();
    });

    it('confirma salir del compositor; cancelar conserva borradores y aceptar vuelve al detalle', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(false);

        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(window.confirm).toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        expect(api.delete).not.toHaveBeenCalled();

        window.confirm.mockReturnValue(true);
        api.delete.mockImplementation(async () => {
            draft.items = [];
            return { data: {} };
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(api.delete).toHaveBeenCalledWith('/orders/order-1/items/draft-1');
        expect(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]').getAttribute('aria-expanded')).toBe('false');
        expect(sheet.querySelector('[data-testid="mesa-sheet-resumen-panel"]')).not.toBeNull();
    });

    it('confirma cerrar la mesa desde el detalle y conserva sent items al aceptar', async () => {
        const sent = item('sent-1', 'Sopa', 1, 12, 'pendiente');
        const draftItem = item('draft-1', 'Agua', 1, 5, 'borrador');
        const account = order('order-1', 11, 'en_preparacion', [sent, draftItem]);
        ({ container, root, sheet } = await openTableWith([account]));
        window.confirm.mockReturnValue(false);

        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(window.confirm).toHaveBeenCalled();
        expect(container.querySelector('[data-testid="mesa-sheet"]')).not.toBeNull();
        expect(api.delete).not.toHaveBeenCalled();

        window.confirm.mockReturnValue(true);
        api.delete.mockImplementation(async () => {
            account.items = account.items.filter((entry) => entry.id !== 'draft-1');
            return { data: {} };
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(api.delete).toHaveBeenCalledWith('/orders/order-1/items/draft-1');
        expect(container.querySelector('[data-testid="mesa-sheet"]')).toBeNull();
        expect(account.items.map((entry) => entry.id)).toEqual(['sent-1']);
    });

    it('si falla el descarte, conserva compositor y borradores y reporta el error', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(true);
        api.delete.mockRejectedValue({ response: { data: { detail: 'No autorizado' } } });

        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(toast.error).toHaveBeenCalledWith('No autorizado');
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
    });

    it('si falla Vaciar, mantiene el ticket y no afirma que se vació', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(true);
        api.delete.mockRejectedValue({ response: { data: { detail: 'No autorizado' } } });
        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));

        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-vaciar"]'));

        expect(api.delete).toHaveBeenCalledWith('/orders/order-1/items/draft-1');
        expect(toast.error).toHaveBeenCalledWith('No autorizado');
        expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/vaciado|eliminado/i));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-item-draft-1"]')).not.toBeNull();
    });

    it('Escape oculta primero el ticket y luego protege la salida del compositor', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(false);
        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));

        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
        expect(window.confirm).not.toHaveBeenCalled();
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        expect(api.delete).not.toHaveBeenCalled();
    });

    it('si falla el envío desde el ticket móvil, mantiene el ticket para recuperar el borrador', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        api.post.mockRejectedValue({ response: { data: { detail: 'Error de cocina' } } });
        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));

        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(toast.error).toHaveBeenCalledWith('Error de cocina');
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-item-draft-1"]')).not.toBeNull();
    });

    it('no permite vaciar borradores mientras enviar cocina está en curso', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        let resolveSend;
        api.post.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
        ({ container, root, sheet } = await openTableWith([draft]));
        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-vaciar"]'));

        expect(window.confirm).not.toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
        resolveSend({ data: { ...draft, status: 'enviado_cocina' } });
        await act(async () => {});
    });

    it('móvil: FAB con los nuevos y monto, y hoja del borrador con scrim', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 2, 12, 'borrador')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(false);

        const fab = sheet.querySelector('[data-testid="mesa-sheet-fab"]');
        expect(fab).not.toBeNull();
        expect(fab.textContent).toContain('Enviar a cocina');
        expect(fab.textContent).toContain('2 nuevos');
        expect(fab.textContent).toContain('S/ 24.00');
        expect(fab.className).toContain('min-[820px]:hidden');

        // El contrato del e2e móvil sigue a la vista sin abrir la hoja.
        expect(sheet.querySelector('[data-testid="mesa-sheet-items"]')).not.toBeNull();

        await click(fab);
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();

        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));
        const ticket = sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]');
        expect(ticket).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-ticket-items"]')).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-ticket-nota-general"]')).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-ticket-enviar-cocina"]').textContent).toContain('S/ 24.00');

        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-scrim"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
        expect(api.delete).not.toHaveBeenCalled();
        expect(window.confirm).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-menos-i1"]')).not.toBeNull();

        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-ticket-cerrar"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
        expect(api.delete).not.toHaveBeenCalled();
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('envía a cocina desde la hoja del borrador y la cierra', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: { ...draft, status: 'enviado_cocina' } });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
    });

    it('tras enviar vuelve al detalle con la cuenta y su tag', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        // El backend real marca los ítems como 'pendiente' al enviarlos.
        const sent = { ...draft, status: 'enviado_cocina', items: [{ ...draft.items[0], status: 'pendiente' }] };
        api.post.mockResolvedValue({ data: sent });
        ({ container, root, sheet } = await openTableWith([draft]));

        // Está en el compositor (franja de persona + carta + ticket).
        expect(sheet.querySelector('[data-testid="mesa-sheet-persona"]')).not.toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        // S10: el envío cierra el compositor y vuelve al detalle, con la tarjeta
        // de la cuenta enviada y su tag (no queda en la carta ni en el ticket).
        expect(sheet.querySelector('[data-testid="mesa-sheet-persona"]')).toBeNull();
        const card = sheet.querySelector('[data-testid="mesa-sheet-pedido-11"]');
        expect(card).not.toBeNull();
        expect(card.textContent).toContain('En cocina');
    });

    it('sin borrador no hay FAB ni hoja', async () => {
        const sent = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([sent]));

        // La carta se abre a mano cuando la cuenta ya salió a cocina.
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-fab"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
    });

    it('S9c: tocar un producto con línea en borrador suma cantidad en vez de crear otra', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Agua', 1, 5, 'borrador', { product_id: 'prod-n1' })], { customer_name: 'Juan' });
        api.patch.mockResolvedValue({ data: {} });
        ({ container, root, sheet } = await openTableWith([draft]));

        // Gesto real: tocar la tarjeta (el botón de nombre).
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]'));

        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/items/i1', { quantity: 2 });
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/items', expect.anything());
    });

    it('S9c: no fusiona con líneas enviadas', async () => {
        const sent = order('order-1', 11, 'en_preparacion', [item('i1', 'Agua', 1, 5, 'pendiente', { product_id: 'prod-n1' })], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: {} });
        ({ container, root, sheet } = await openTableWith([sent]));
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]'));
        // Lo enviado no se toca: la unidad nueva entra como línea aparte.
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/items', [{ product_id: 'prod-n1', quantity: 1 }]);
    });

    it('S9c: no fusiona con líneas que tienen nota', async () => {
        const noted = order('order-2', 12, 'nuevo', [item('i2', 'Agua', 1, 5, 'borrador', { product_id: 'prod-n1', notes: 'Sin hielo' })], { customer_name: 'Ana' });
        api.post.mockResolvedValue({ data: {} });
        ({ container, root, sheet } = await openTableWith([noted]));
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]'));
        // Una línea con nota no absorbe unidades sin nota.
        expect(api.post).toHaveBeenCalledWith('/orders/order-2/items', [{ product_id: 'prod-n1', quantity: 1 }]);
    });

    it('S9c: el − del borrador decrementa y borra la línea al llegar a 0', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Agua', 1, 5, 'borrador', { product_id: 'prod-n1' })], { customer_name: 'Juan' });
        api.delete.mockResolvedValue({ data: {} });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-item-menos-i1"]'));
        expect(api.delete).toHaveBeenCalledWith('/orders/order-1/items/i1');
    });

    it('S12: lo enviado va en su bloque `.sent` con el tag del pedido y líneas peladas', async () => {
        const sent = item('i1', 'Sopa', 1, 12, 'pendiente', { product_id: 'prod-sopa' });
        const draft = item('i2', 'Agua', 1, 5, 'borrador', { product_id: 'prod-n1' });
        const account = order('order-1', 11, 'en_preparacion', [sent, draft], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([account]));
        window.confirm.mockReturnValue(true);
        api.delete.mockImplementation(async () => {
            account.items = account.items.filter((entry) => entry.id !== 'i2');
            return { data: {} };
        });

        // La tarjeta ya no edita acá: el ticket se abre con "+ Nuevo pedido".
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));

        const ticket = sheet.querySelector('[data-testid="mesa-sheet-ticket"]');
        expect(ticket).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-item-i1"]')).toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-item-i2"]')).not.toBeNull();
        expect(ticket.querySelector('[data-testid="mesa-sheet-enviados"]')).toBeNull();
        expect(ticket.querySelectorAll('[data-testid$="-enviar-cocina"]')).toHaveLength(1);
        expect(sheet.querySelectorAll('[data-testid="mesa-sheet-persona-renombrar"]')).toHaveLength(1);
        // Sent history remains available in the table detail after closing the composer.
        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-i1"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-i2"]')).toBeNull();
        // S12: sin chips de estado por línea (el estado es por pedido).
        expect(sheet.querySelector('[data-testid^="mesa-sheet-item-estado-"]')).toBeNull();
    });

    it('oculta productos no disponibles en la carta del salón', async () => {
        mockProducts.push({ id: 'prod-out', name: 'Producto agotado', price: 9, is_available: false, category_id: 'c1' });
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));

        expect(sheet.querySelector('[data-testid="mesa-sheet-producto-fila-prod-out"]')).toBeNull();
    });

    it('envía directamente desde la carta y conserva el borrador mientras el request está en curso', async () => {
        const draft = order('order-1', 11, 'nuevo', [
            item('i1', 'Sopa', 2, 12, 'borrador', { product_id: 'prod-sopa' }),
            item('i2', 'Agua', 1, 5, 'borrador', { product_id: 'prod-n1' }),
        ], { customer_name: 'Juan' });
        let resolveSend;
        api.post.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        expect(api.post).toHaveBeenCalledTimes(1);
        resolveSend({ data: { ...draft, status: 'enviado_cocina' } });
        await act(async () => {});
    });

    it('revisa el borrador antes del envío y solo confirma al aceptar', async () => {
        const draft = order('order-1', 11, 'nuevo', [
            item('i1', 'Sopa', 2, 12, 'borrador', { notes: 'Sin cebolla' }),
        ], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: { ...draft, status: 'enviado_cocina' } });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));

        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        const review = document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]');
        expect(review).not.toBeNull();
        expect(review.textContent).toContain('Juan');
        expect(review.textContent).toContain('Sopa');
        expect(review.textContent).toContain('2');
        expect(review.textContent).toContain('Sin cebolla');
        expect(review.textContent).toContain('S/ 24.00');

        await click(review.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
    });

    it('la revisión usa el snapshot actualizado, no la cuenta histórica del listado', async () => {
        const initial = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        const current = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 3, 12, 'borrador')], { customer_name: 'Juan' });
        api.patch.mockResolvedValue({ data: {} });
        ({ container, root, sheet } = await openTableWith([initial]));
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-1') return Promise.resolve({ data: current });
            return Promise.resolve({ data: [initial] });
        });

        await click(sheet.querySelector('[data-testid="mesa-sheet-item-mas-i1"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        const review = document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]');

        expect(review.textContent).toContain('3× Sopa');
        expect(review.textContent).toContain('S/ 36.00');
        expect(review.textContent).not.toContain('1× Sopa');
    });

    it('bloquea la confirmación si el borrador deja de ser enviable durante la revisión', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([draft]));
        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));

        draft.items[0].status = 'cancelado';
        await type(container.querySelector('[data-testid="salon-search-input"]'), 'Mesa');

        const confirm = document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]');
        expect(confirm.disabled).toBe(true);
        await click(confirm);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
    });

    it('volver a editar cierra la revisión sin perder el borrador', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        const review = document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]');
        await click(review.querySelector('[data-testid="mesa-sheet-volver-editar"]'));

        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-i1"]')).not.toBeNull();
    });

    it('envía a cocina y avisa con el toast del mockup sin una pantalla de confirmación', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        const sent = { ...draft, status: 'enviado_cocina', items: [{ ...draft.items[0], status: 'pendiente' }] };
        api.post.mockResolvedValue({ data: sent });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));

        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(toast.success).toHaveBeenCalledWith('Enviado a cocina · Mesa 1');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
    });
});

describe('edición explícita de borradores (T04)', () => {
    let root;
    let container;

    beforeEach(() => { mockRole = 'admin'; });
    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        container = null;
        document.body.innerHTML = '';
    });

    it('permite editar solo la cuenta pulsada en una mesa con varias cuentas', async () => {
        const sentOnly = order('order-sent', 21, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const mixed = order('order-mixed', 22, 'en_preparacion', [
            item('s2', 'Arroz', 1, 10, 'pendiente'), item('d2', 'Agua', 1, 5, 'borrador'),
        ]);
        const accounts = [sentOnly, mixed];
        ({ container, root } = await openTableWith(accounts));
        const mixedCard = container.querySelector('[data-testid="mesa-sheet-pedido-22"]');
        const edit = mixedCard.querySelector('[data-testid="mesa-sheet-editar-pedido"]');
        expect(edit).not.toBeNull();
        await click(edit);
        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).toBeNull();
        expect(container.textContent).toContain('Agua');
        expect(container.querySelector('[data-testid="mesa-sheet-ticket-item-s2"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalledWith(expect.stringMatching(/\/kitchen|\/send/), expect.anything());
    });

    it('no ofrece edición para cuenta solo enviada ni para cajero', async () => {
        const sent = order('order-sent', 21, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        ({ container, root } = await openTableWith([sent]));
        expect(container.querySelector('[data-testid="mesa-sheet-editar-pedido"]')).toBeNull();
        await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';

        mockRole = 'cajero';
        const draft = order('order-draft', 23, 'nuevo', [item('d1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root } = await openTableWith([draft]));
        expect(container.querySelector('[data-testid="mesa-sheet-editar-pedido"]')).toBeNull();
    });

    it('no abre otra cuenta si falla su carga antes de editarla', async () => {
        const first = order('order-first', 41, 'en_preparacion', [item('f1', 'Sopa', 1, 12, 'pendiente')]);
        const second = order('order-second', 42, 'en_preparacion', [item('d2', 'Agua', 1, 5, 'borrador')]);
        const accounts = [first, second];
        ({ container, root } = await openTableWith(accounts));
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-second') return Promise.reject(new Error('offline'));
            const match = accounts.find((entry) => url === `/orders/${entry.id}`);
            return Promise.resolve({ data: match || accounts });
        });

        await click(container.querySelector('[data-testid="mesa-sheet-pedido-42"] [data-testid="mesa-sheet-editar-pedido"]'));

        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('revalida borradores tras cargar y no abre el compositor si ya se enviaron', async () => {
        const first = order('order-first', 51, 'en_preparacion', [item('f1', 'Sopa', 1, 12, 'pendiente')]);
        const stale = order('order-stale', 52, 'en_preparacion', [item('d2', 'Agua', 1, 5, 'borrador')]);
        const accounts = [first, stale];
        ({ container, root } = await openTableWith(accounts));
        const sent = order('order-stale', 52, 'en_preparacion', [item('d2', 'Agua', 1, 5, 'pendiente')]);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-stale') return Promise.resolve({ data: sent });
            const match = accounts.find((entry) => url === `/orders/${entry.id}`);
            return Promise.resolve({ data: match || accounts });
        });

        await click(container.querySelector('[data-testid="mesa-sheet-pedido-52"] [data-testid="mesa-sheet-editar-pedido"]'));

        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="mesa-sheet-editar-pedido"]')).toBeNull();
    });

    it('vuelve desde revisión a editar la cuenta correcta y avisa del bloqueo tras envío', async () => {
        const first = order('order-first', 31, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const draft = order('order-draft', 32, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        const accounts = [first, draft];
        ({ container, root } = await openTableWith(accounts));
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-32"]'));
        await click(container.querySelector('[data-testid="mesa-sheet-editar-pedido"]'));
        await click(container.querySelector('[data-testid="mesa-sheet-abrir-ticket"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-ticket-enviar-cocina"]'));
        expect(document.body.textContent).toContain('Después de confirmar, los productos enviados no se pueden editar.');
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));
        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).toBeNull();
        expect(container.textContent).toContain('Agua');
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-draft/send', expect.anything());
    });

    it('vuelve desde revisión del mini al compositor de la cuenta cargada', async () => {
        const draft = order('order-mini', 61, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        const accounts = [draft];
        ({ container, root } = await openTableWith(accounts));
        window.confirm = jest.fn().mockReturnValue(true);
        api.delete.mockResolvedValue({ data: {} });
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        await click(container.querySelector('[data-testid="salon-mini-accion"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();

        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));

        expect(container.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        expect(container.textContent).toContain('Agua');
    });

    it('no abre el compositor desde revisión del mini si la cuenta ya no se puede cargar', async () => {
        const draft = order('order-mini', 62, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        const accounts = [draft];
        ({ container, root } = await openTableWith(accounts));
        window.confirm = jest.fn().mockReturnValue(true);
        api.delete.mockResolvedValue({ data: {} });
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        await click(container.querySelector('[data-testid="salon-mini-accion"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-mini') return Promise.reject(new Error('offline'));
            return Promise.resolve({ data: accounts });
        });

        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));

        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).not.toBeNull();
    });

    it('no abre el compositor desde revisión del mini si la cuenta cargada ya no tiene borradores', async () => {
        const draft = order('order-mini', 63, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        const accounts = [draft];
        ({ container, root } = await openTableWith(accounts));
        window.confirm = jest.fn().mockReturnValue(true);
        api.delete.mockResolvedValue({ data: {} });
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver"]'));
        await click(container.querySelector('[data-testid="salon-mini-accion"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        const emptyOrder = order('order-mini', 63, 'en_preparacion', []);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            if (url === '/orders/order-mini') return Promise.resolve({ data: emptyOrder });
            return Promise.resolve({ data: accounts });
        });

        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));

        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).not.toBeNull();
    });
});

