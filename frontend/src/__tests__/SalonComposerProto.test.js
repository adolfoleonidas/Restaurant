/**
 * Inline composer parity (S8, posView).
 *
 * - Optional account identity above the product catalog.
 * - One inline draft ticket with quantity, notes, clear, and send controls.
 * - The ticket send action opens review; only explicit confirmation submits.
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
        mockRole = 'admin';
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

    it('starts an independent order lazily and preserves the latest named shared draft card', async () => {
        const firstAccount = order('order-1', 11, 'enviado_cocina', [
            item('sent-1', 'Sopa', 1, 12, 'pendiente'),
            item('draft-1', 'Agua', 1, 5, 'borrador', { notes: 'Sin hielo' }),
        ], { customer_name: 'Juan', shared: true });
        const latest = { ...firstAccount, customer_name: 'Familia', updated_at: '2026-10-11T12:00:00Z', items: [
            firstAccount.items[0], { ...firstAccount.items[1], quantity: 3, subtotal: 15 },
        ] };
        const nextAccount = order('order-2', 12, 'nuevo', []);
        ({ container, root, sheet } = await openTableWith([firstAccount]));
        api.get.mockImplementation((url) => {
            if (url === '/orders/order-1') return Promise.resolve({ data: latest });
            if (url === '/orders/order-2') return Promise.resolve({ data: nextAccount });
            return Promise.resolve({ data: [firstAccount] });
        });
        api.post.mockImplementation((url) => {
            if (url === '/orders') return Promise.resolve({ data: nextAccount });
            if (url === '/orders/order-2/items') {
                nextAccount.items = [item('next-1', 'Ceviche', 1, 38, 'borrador', { product_id: 'prod-n1' })];
                return Promise.resolve({ data: nextAccount });
            }
            return Promise.resolve({ data: {} });
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-renombrar-11"]'));
        const name = sheet.querySelector('[data-testid="mesa-sheet-renombrar-input-11"]');
        await type(name, 'Familia');
        await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/alias', { alias: 'Familia', shared: true });

        expect(sheet.querySelector('[data-testid="mesa-sheet-agregar-persona"]')).toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        expect(api.post).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-agregar-persona"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-draft-1"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-persona"]').textContent).not.toContain('Familia');
        await click(sheet.querySelector('[data-testid="mesa-sheet-persona-renombrar"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-persona-nombre"]').value).toBe('');
        expect(sheet.querySelector('[data-testid="mesa-sheet-compartido"]').getAttribute('aria-pressed')).toBe('false');
        await act(async () => sheet.querySelector('[data-testid="mesa-sheet-persona-nombre"]')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        const product = sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);

        expect(api.post).toHaveBeenCalledWith('/orders', { table_id: 'table-1', order_type: 'mesa', new_account: true });
        expect(api.post).toHaveBeenCalledWith('/orders/order-2/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/items', expect.anything());
        expect(api.patch).not.toHaveBeenCalledWith('/orders/order-1/items/draft-1', expect.anything());
        expect(api.delete).not.toHaveBeenCalled();
        window.confirm.mockReturnValue(true);
        api.delete.mockImplementation(async () => {
            nextAccount.items = [];
            return { data: {} };
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-volver"]'));
        expect(container.contains(sheet)).toBe(true);
        const previousCard = sheet.querySelector('[data-testid="mesa-sheet-pedido-11"]');
        expect(previousCard.textContent).toContain('Familia');
        expect(previousCard.textContent).toContain('3× Agua');
        expect(previousCard.textContent).toContain('Sin hielo');
        expect(api.delete).toHaveBeenCalledTimes(1);
        expect(api.delete).toHaveBeenCalledWith('/orders/order-2/items/next-1');
        expect(firstAccount.customer_name).toBe('Juan');
        expect(firstAccount.items.find((entry) => entry.id === 'draft-1')).toEqual(
            expect.objectContaining({ status: 'borrador', notes: 'Sin hielo' })
        );
        await click(previousCard.querySelector('[data-testid="mesa-sheet-editar-pedido"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-persona-renombrar"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-persona-nombre"]').value).toBe('Familia');
        expect(sheet.querySelector('[data-testid="mesa-sheet-compartido"]').getAttribute('aria-pressed')).toBe('true');
    });

    it('no ofrece agregar persona a roles que no pueden tomar pedidos', async () => {
        mockRole = 'cajero';
        const sent = order('order-1', 11, 'enviado_cocina', [item('i1', 'Sopa', 1, 12, 'pendiente')]);
        ({ container, root, sheet } = await openTableWith([sent]));

        expect(sheet.querySelector('[data-testid="mesa-sheet-agregar-persona"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
    });

    it('no ofrece agregar persona cuando la mesa pagada no permite componer', async () => {
        const paid = order('order-1', 11, 'pagado', [item('i1', 'Sopa', 1, 12, 'entregado')]);
        ({ container, root, sheet } = await openTableWith([paid], { status: 'pagada' }));

        expect(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-agregar-persona"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
    });

    it('sends an unnamed independent order only after explicit review confirmation', async () => {
        const first = order('order-first', 21, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')],
            { customer_name: 'Juan', shared: true });
        let next = order('order-next', 22, 'nuevo', []);
        ({ container, root, sheet } = await openTableWith([first]));
        api.get.mockImplementation((url) => Promise.resolve({ data: url === '/orders/order-next' ? next : first }));
        api.post.mockImplementation(async (url) => {
            if (url === '/orders/order-next/items') {
                next = { ...next, items: [item('d1', 'Ceviche', 1, 38, 'borrador', { product_id: 'prod-n1' })] };
            }
            if (url === '/orders/order-next/send-to-kitchen') {
                next = { ...next, status: 'enviado_cocina', items: [{ ...next.items[0], status: 'pendiente' }] };
            }
            return { data: next };
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-next/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-next/send-to-kitchen');
        expect(api.patch).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido-21"]').textContent).toContain('Juan');
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido-22"]').textContent).toContain('Persona 2');
    });

    it('confirma Vaciar, cancela sin borrar y al aceptar elimina solo borradores', async () => {
        const sent = item('sent-1', 'Sopa', 1, 12, 'pendiente');
        const draftItem = item('draft-1', 'Agua', 1, 5, 'borrador');
        const account = order('order-1', 11, 'en_preparacion', [sent, draftItem]);
        ({ container, root, sheet } = await openTableWith([account]));
        window.confirm = jest.fn().mockReturnValue(false);
        await click(sheet.querySelector('[data-testid="mesa-sheet-pedido-11"] [data-testid="mesa-sheet-editar-pedido"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-vaciar"]'));
        expect(window.confirm).toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket"]')).not.toBeNull();

        window.confirm.mockReturnValue(true);
        api.delete.mockImplementation(async () => {
            account.items = account.items.filter((entry) => entry.id !== 'draft-1');
            return { data: {} };
        });
        await click(sheet.querySelector('[data-testid="mesa-sheet-vaciar"]'));
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
        await click(sheet.querySelector('[data-testid="mesa-sheet-vaciar"]'));

        expect(api.delete).toHaveBeenCalledWith('/orders/order-1/items/draft-1');
        expect(toast.error).toHaveBeenCalledWith('No autorizado');
        expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/vaciado|eliminado/i));
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-draft-1"]')).not.toBeNull();
    });

    it('Escape protects the inline composer draft before leaving', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(false);
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(sheet.querySelector('[data-testid="mesa-sheet-pedido"]')).not.toBeNull();
        expect(api.delete).not.toHaveBeenCalled();
    });

    it('keeps the inline draft and review available after failure and allows an explicit retry', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        const sent = { ...draft, status: 'enviado_cocina', items: [{ ...draft.items[0], status: 'pendiente' }] };
        api.post.mockRejectedValueOnce({ response: { data: { detail: 'Error de cocina' } } })
            .mockResolvedValue({ data: sent });
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket"] [data-testid="mesa-sheet-enviar-cocina"]'));
        expect(api.post).not.toHaveBeenCalled();
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(toast.error).toHaveBeenCalledWith('Error de cocina');
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-draft-1"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        expect(api.post).toHaveBeenCalledTimes(1);
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledTimes(2);
        expect(api.post).toHaveBeenLastCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket"]')).toBeNull();
    });

    it('no permite vaciar borradores mientras enviar cocina está en curso', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('draft-1', 'Agua', 1, 5, 'borrador')]);
        let resolveSend;
        api.post.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
        ({ container, root, sheet } = await openTableWith([draft]));
        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-vaciar"]'));

        expect(window.confirm).not.toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
        resolveSend({ data: { ...draft, status: 'enviado_cocina' } });
        await act(async () => {});
    });

    it('anchors the sole ticket send action above mobile navigation without full-width overflow', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 2, 12, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));

        const send = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(send).not.toBeNull();
        expect(send.className.split(/\s+/)).toEqual(expect.arrayContaining([
            'fixed', 'left-3', 'right-3',
            'bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom)+10px)]', 'z-30',
            'min-h-[54px]', 'w-auto', 'min-w-0', 'whitespace-normal',
        ]));
        expect(send.classList.contains('w-full')).toBe(false);
        expect(sheet.className.split(/\s+/)).toEqual(expect.arrayContaining([
            'pb-28', 'min-[820px]:pb-0',
        ]));
    });

    it('provides desktop inline overrides on the same ticket send node', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 2, 12, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));

        const ticket = sheet.querySelector('[data-testid="mesa-sheet-ticket"]');
        const send = ticket.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(send.className.split(/\s+/)).toEqual(expect.arrayContaining([
            'min-[820px]:static', 'min-[820px]:inset-auto',
            'min-[820px]:z-auto', 'min-[820px]:w-full',
        ]));
        expect(ticket.parentElement.className.split(/\s+/)).toEqual(expect.arrayContaining([
            'min-[820px]:sticky', 'min-[820px]:top-4',
        ]));

        await type(container.querySelector('[data-testid="salon-search-input"]'), 'Mesa');
        expect(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]')).toBe(send);
        expect(sheet.querySelectorAll('[data-testid="mesa-sheet-enviar-cocina"]')).toHaveLength(1);
    });

    it('mobile keeps exactly one ticket send action with inline editing and review cancellation', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 2, 12, 'borrador')], { customer_name: 'Juan' });
        api.patch.mockResolvedValue({ data: {} });
        ({ container, root, sheet } = await openTableWith([draft]));
        window.confirm = jest.fn().mockReturnValue(false);

        const sendActions = [...sheet.querySelectorAll('button')].filter((button) => (
            !button.closest('[hidden]') && /Enviar a cocina/.test(button.textContent)
        ));
        expect(sendActions).toHaveLength(1);
        expect(sheet.querySelector('[data-testid="mesa-sheet-fab"]')).toBeNull();

        // Draft editing stays inline while the mobile send action opens review.
        expect(sheet.querySelector('[data-testid="mesa-sheet-items"]')).not.toBeNull();
        const inlineTicket = sheet.querySelector('[data-testid="mesa-sheet-ticket"]');
        expect(inlineTicket).not.toBeNull();
        const send = inlineTicket.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(sendActions).toEqual([send]);
        expect(send.textContent).toContain('Enviar a cocina');
        expect(send.textContent).toContain('S/ 24.00');
        expect(inlineTicket.querySelector('[data-testid="mesa-sheet-pedido-resumen"]').textContent).toContain('S/ 24.00');
        expect(inlineTicket.querySelector('[data-testid="mesa-sheet-item-i1"]').textContent).toContain('2× Sopa');
        expect(inlineTicket.querySelector('[data-testid="mesa-sheet-vaciar"]')).not.toBeNull();
        expect(sheet.querySelectorAll('[data-testid="mesa-sheet-ticket"]')).toHaveLength(1);
        expect(sheet.querySelector('[data-testid="mesa-sheet-abrir-ticket"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
        expect(inlineTicket.querySelector('[data-testid="mesa-sheet-item-menos-i1"]')).not.toBeNull();
        expect(inlineTicket.querySelector('[data-testid="mesa-sheet-item-nota-i1"]')).not.toBeNull();
        await click(inlineTicket.querySelector('[data-testid="mesa-sheet-item-mas-i1"]'));
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/items/i1', { quantity: 3 });
        await click(inlineTicket.querySelector('[data-testid="mesa-sheet-item-nota-i1"]'));
        const itemNotes = inlineTicket.querySelector('[data-testid="mesa-sheet-item-notas-i1"]');
        await type(itemNotes, 'Sin cebolla');
        await act(async () => itemNotes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/items/i1', { notes: 'Sin cebolla' });

        await click(send);
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
        expect(inlineTicket.querySelector('[data-testid="mesa-sheet-enviar-cocina"]')).toBe(send);

        expect(api.delete).not.toHaveBeenCalled();
        expect(window.confirm).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-i1"]')).not.toBeNull();
    });

    it('keeps the ticket send and clear actions guarded until a pending draft write completes', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 2, 12, 'borrador')]);
        ({ container, root, sheet } = await openTableWith([draft]));
        let resolveWrite;
        api.patch.mockReturnValue(new Promise((resolve) => { resolveWrite = resolve; }));
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-mas-i1"]'));
        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/items/i1', { quantity: 3 });
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket"] [data-testid="mesa-sheet-enviar-cocina"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-vaciar"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
        expect(window.confirm).not.toHaveBeenCalled();
        await act(async () => resolveWrite({ data: {} }));
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket"] [data-testid="mesa-sheet-enviar-cocina"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('sends from the inline draft ticket after review confirmation', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: { ...draft, status: 'enviado_cocina' } });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        expect(api.post).not.toHaveBeenCalled();
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(sheet.querySelector('[data-testid="mesa-sheet-ticket"]')).toBeNull();
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

    it('an empty new composition offers neither sending nor a ticket drawer', async () => {
        const sent = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([sent]));

        // La carta se abre a mano cuando la cuenta ya salió a cocina.
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-fab"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]')).toBeNull();
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
        await click(sheet.querySelector('[data-testid="mesa-sheet-pedido-11"] [data-testid="mesa-sheet-editar-pedido"]'));
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

        // Existing-account corrections enter through that card, not New order.
        await click(sheet.querySelector('[data-testid="mesa-sheet-pedido-11"] [data-testid="mesa-sheet-editar-pedido"]'));

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
        expect(review.getAttribute('aria-labelledby')).toBeTruthy();
        expect(review.getAttribute('aria-describedby')).toBeTruthy();
        expect(document.getElementById(review.getAttribute('aria-describedby')).textContent)
            .toMatch(/revisa.*borradores.*antes de confirmar/i);
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
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-vacia"]').textContent)
            .toMatch(/no hay.*borradores.*actualiza/i);
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

    it('conserva la revisión y los borradores si falla el envío confirmado', async () => {
        const draft = order('order-1', 11, 'nuevo', [item('i1', 'Sopa', 1, 12, 'borrador')], { customer_name: 'Juan' });
        api.post.mockRejectedValue({ response: { data: { detail: 'Error de cocina' } } });
        ({ container, root, sheet } = await openTableWith([draft]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
        const review = document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]');
        await click(review.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));

        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]').textContent).toContain('Sopa');
        expect(toast.error).toHaveBeenCalledWith('Error de cocina');
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

    beforeEach(() => {
        mockRole = 'admin';
        window.confirm = jest.fn().mockReturnValue(false);
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
        api.post.mockResolvedValue({ data: {} });
        api.patch.mockResolvedValue({ data: {} });
        mockProducts.splice(0, mockProducts.length,
            { id: 'prod-n1', name: 'Ceviche', price: 38, is_available: true, category_id: 'c1' });
    });
    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        window.confirm = originalConfirm;
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
        expect(container.querySelector('[data-testid="mesa-sheet-item-s2"]')).toBeNull();
        const product = container.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);
        expect(api.post).toHaveBeenCalledWith('/orders/order-mixed/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
        expect(api.post).not.toHaveBeenCalledWith(expect.stringMatching(/\/kitchen|\/send/), expect.anything());
    });

    it('adds through a sent-only open card to that same account without editing sent lines', async () => {
        const sent = order('order-sent', 21, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        ({ container, root } = await openTableWith([sent]));
        const card = container.querySelector('[data-testid="mesa-sheet-pedido-21"]');
        const edit = card.querySelector('[data-testid="mesa-sheet-editar-pedido"]');
        expect(edit).not.toBeNull();
        await click(edit);
        expect(api.get).toHaveBeenCalledWith('/orders/order-sent');
        const product = container.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);
        expect(api.post).toHaveBeenCalledWith('/orders/order-sent/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
        expect(api.patch).not.toHaveBeenCalledWith('/orders/order-sent/items/s1', expect.anything());
        expect(container.querySelector('[data-testid="mesa-sheet-item-mas-s1"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-sheet-item-nota-s1"]')).toBeNull();
    });

    it('does not offer account modification to a cashier', async () => {
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

    it('allows additions after a fresh card fetch finds that previous drafts were already sent', async () => {
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

        const product = container.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);
        expect(api.post).toHaveBeenCalledWith('/orders/order-stale/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
    });

    it.each([
        ['paid', { status: 'pagado' }],
        ['cancelled', { status: 'cancelado' }],
        ['closed visit', { attention_state: 'closed' }],
        ['another visit', { attention_id: 'att-2' }],
        ['moved table', { table_id: 'table-2' }],
        ['another branch', { branch_id: 'branch-2' }],
        ['non-table order', { order_type: 'llevar' }],
    ])('rejects a stale card whose fresh account is in %s context', async (_, changed) => {
        const first = order('order-first', 71, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const target = order('order-target', 72, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root } = await openTableWith([first, target]));
        api.get.mockImplementation((url) => Promise.resolve({ data: url === '/orders/order-target'
            ? { ...target, ...changed } : first }));
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-72"] [data-testid="mesa-sheet-editar-pedido"]'));
        expect(api.get).toHaveBeenCalledWith('/orders/order-target');
        expect(container.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]').closest('[hidden]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        expect(api.patch).not.toHaveBeenCalled();
        expect(api.delete).not.toHaveBeenCalled();
    });

    it.each(['pagada', 'reservada', 'inactiva', 'esperando_pago'])('offers no composition entry for a %s table', async (status) => {
        const account = order('order-1', 11, 'en_preparacion', [
            item('s1', 'Sopa', 1, 12, 'pendiente'), item('d1', 'Agua', 1, 5, 'borrador'),
        ]);
        ({ container, root } = await openTableWith([account], { status }));
        expect(container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).toBeNull();
        expect(container.querySelector('[data-testid="mesa-sheet-pedido-11"] [data-testid="mesa-sheet-editar-pedido"]')).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('blocks new-order and account switches during a fresh account load', async () => {
        const first = order('order-first', 81, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const second = order('order-second', 82, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root } = await openTableWith([first, second]));
        let resolveLoad;
        api.get.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
        api.get.mockClear();
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-82"] [data-testid="mesa-sheet-editar-pedido"]'));
        const newOrder = container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]');
        expect(newOrder.disabled).toBe(true);
        await click(newOrder);
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-81"]'));
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.post).not.toHaveBeenCalled();
        await act(async () => resolveLoad({ data: second }));
        const product = container.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);
        expect(api.post).toHaveBeenCalledWith('/orders/order-second/items', [{ product_id: 'prod-n1', quantity: 1 }]);
    });

    it('blocks switching targets while an optional card name is being saved', async () => {
        const first = order('order-first', 91, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const second = order('order-second', 92, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        ({ container, root } = await openTableWith([first, second]));
        let resolveName;
        api.patch.mockReturnValue(new Promise((resolve) => { resolveName = resolve; }));
        await click(container.querySelector('[data-testid="mesa-sheet-renombrar-91"]'));
        const name = container.querySelector('[data-testid="mesa-sheet-renombrar-input-91"]');
        await type(name, 'Juan');
        await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        const newOrder = container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]');
        expect(newOrder.disabled).toBe(true);
        api.get.mockClear();
        await click(newOrder);
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-92"]'));
        expect(api.get).not.toHaveBeenCalled();
        expect(api.post).not.toHaveBeenCalled();
        await act(async () => resolveName({ data: {} }));
    });

    it('waits for the initial account list before allowing an independent target switch', async () => {
        const first = order('order-first', 95, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const next = order('order-next', 96, 'nuevo', []);
        mockTables.splice(0, mockTables.length, baseTable(1));
        mockOrders.splice(0, mockOrders.length, first);
        let resolveHistory;
        api.get.mockImplementation((url) => {
            if (url === '/orders') return new Promise((resolve) => { resolveHistory = resolve; });
            if (url === '/orders/order-first') return Promise.resolve({ data: first });
            if (url === '/orders/order-next') return Promise.resolve({ data: next });
            return Promise.resolve({ data: [] });
        });
        api.post.mockImplementation((url) => Promise.resolve({ data: url === '/orders' ? next : {} }));
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        const newOrder = container.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]');
        expect(newOrder.disabled).toBe(true);
        await click(newOrder);
        expect(api.post).not.toHaveBeenCalled();
        await act(async () => resolveHistory({ data: [first] }));
        expect(newOrder.disabled).toBe(false);
        await click(newOrder);
        const product = container.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);
        expect(api.post).toHaveBeenCalledWith('/orders', { table_id: 'table-1', order_type: 'mesa', new_account: true });
        expect(api.post).toHaveBeenCalledWith('/orders/order-next/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-first/items', expect.anything());
    });

    it('keeps draft card names visible and optional without changing shared identity', async () => {
        const first = order('order-first', 101, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        let draft = order('order-draft', 102, 'nuevo', [], { shared: true });
        ({ container, root } = await openTableWith([first, draft]));
        api.get.mockImplementation((url) => Promise.resolve({ data: url === '/orders/order-draft' ? draft : first }));
        api.patch.mockImplementation(async (_, payload) => {
            draft = { ...draft, customer_name: payload.alias };
            return { data: draft };
        });
        for (const alias of ['Familia', '']) {
            await click(container.querySelector('[data-testid="mesa-sheet-renombrar-102"]'));
            const name = container.querySelector('[data-testid="mesa-sheet-renombrar-input-102"]');
            await type(name, alias);
            await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
            expect(api.patch).toHaveBeenCalledWith('/orders/order-draft/alias', { alias: alias || null, shared: true });
            expect(container.querySelector('[data-testid="mesa-sheet-pedido-102"] header').textContent)
                .toContain(alias || 'Compartido');
        }
        expect(api.post).not.toHaveBeenCalled();
    });

    it.each([
        ['new order', 'ocupada'], ['existing card', 'ocupada'], ['existing card', 'pagada'],
    ])('preserves grouped-table composition context for %s on a %s member', async (entry, status) => {
        const group = { id: 'group-1', anchor_table_id: 'table-1', table_ids: ['table-1', 'table-2'] };
        const owner = order('order-owner', 111, 'en_preparacion', [
            item('s1', 'Sopa', 1, 12, 'pendiente'), item('d1', 'Agua', 1, 5, 'borrador'),
        ],
            { customer_name: 'Juan', shared: true });
        const next = order('order-next', 112, 'nuevo', [], { table_id: 'table-2', attention_id: 'att-2' });
        mockTables.splice(0, mockTables.length,
            baseTable(1, { group, active_order: { id: owner.id, status: owner.status } }),
            baseTable(2, { group, active_attention_id: 'att-2', status }));
        mockOrders.splice(0, mockOrders.length, owner);
        api.get.mockImplementation((url) => {
            if (url === '/orders/order-owner') return Promise.resolve({ data: owner });
            if (url === '/orders/order-next') return Promise.resolve({ data: next });
            return Promise.resolve({ data: [] });
        });
        api.post.mockImplementation((url) => Promise.resolve({ data: url === '/orders' ? next : {} }));
        ({ container, root } = await renderPage());
        await click(container.querySelector('[data-testid="mesa-grupo-miembro-2"]'));
        const sheet = container.querySelector('[data-testid="mesa-sheet"]');
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-grupo"]').textContent).toContain('Mesa 1');
        if (status === 'pagada') {
            expect(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]')).toBeNull();
            expect(sheet.querySelector('[data-testid="mesa-sheet-pedido-111"] [data-testid="mesa-sheet-editar-pedido"]')).toBeNull();
            expect(api.post).not.toHaveBeenCalled();
            return;
        }
        if (entry === 'new order') {
            await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
            expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-grupo"]')).toBeNull();
            expect(sheet.querySelector('[data-testid="mesa-sheet-persona"]').textContent).toContain('Mesa 2');
        } else {
            await click(sheet.querySelector('[data-testid="mesa-sheet-pedido-111"] [data-testid="mesa-sheet-editar-pedido"]'));
            expect(sheet.querySelector('[data-testid="mesa-sheet-persona"]').textContent).toContain('Juan');
        }
        expect(sheet.querySelectorAll('[data-testid^="mesa-sheet-grupo-miembro-"]')).toHaveLength(2);
        const product = sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);
        if (entry === 'new order') {
            expect(api.post).toHaveBeenCalledWith('/orders', { table_id: 'table-2', order_type: 'mesa', new_account: true });
            expect(api.post).toHaveBeenCalledWith('/orders/order-next/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        } else {
            expect(api.post).not.toHaveBeenCalledWith('/orders', expect.anything());
            expect(api.post).toHaveBeenCalledWith('/orders/order-owner/items', [{ product_id: 'prod-n1', quantity: 1 }]);
        }
        expect(owner).toEqual(expect.objectContaining({ table_id: 'table-1', attention_id: 'att-1', customer_name: 'Juan', shared: true }));
    });

    it('vuelve desde revisión a editar la cuenta correcta y avisa del bloqueo tras envío', async () => {
        const first = order('order-first', 31, 'en_preparacion', [item('s1', 'Sopa', 1, 12, 'pendiente')]);
        const draft = order('order-draft', 32, 'en_preparacion', [item('d1', 'Agua', 1, 5, 'borrador')]);
        const accounts = [first, draft];
        ({ container, root } = await openTableWith(accounts));
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-32"]'));
        await click(container.querySelector('[data-testid="mesa-sheet-pedido-32"] [data-testid="mesa-sheet-editar-pedido"]'));
        await click(container.querySelector('[data-testid="mesa-sheet-enviar-cocina"]'));
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

