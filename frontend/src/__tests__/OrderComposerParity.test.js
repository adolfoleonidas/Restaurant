/**
 * Paridad del compositor de carta con el prototipo final (Slice 3) y nota
 * general para cocina (S3-3):
 * - S3-1: badge de cantidad en la esquina superior de la tarjeta de producto.
 * - S3-2: el botón de envío lleva el total de lo que se manda.
 * - S3-3: textarea de nota general, guardada con el PATCH del pedido.
 *
 * El compositor es compartido (Salón y Nuevo pedido): se monta solo, con el
 * prefijo de cada pantalla, para cubrir ambos contratos de testids.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OrderComposer from '@/components/OrderComposer';
import { api } from '@/lib/api';
import { toast } from 'sonner';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const product = (id, name, price) => ({ id, name, price, is_available: true, category_id: 'c1' });

const item = (id, productId, name, quantity, price, status = 'borrador') => ({
    id,
    product_id: productId,
    product_name: name,
    quantity,
    unit_price: price,
    subtotal: quantity * price,
    status,
    notes: null,
});

async function mountComposer(props) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<OrderComposer canCompose {...props} />));
    return { host, root };
}

describe('compositor · paridad del prototipo (Slice 3)', () => {
    let host;
    let root;

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    it('UX-13 shows an inline stepper instead of the badge when the product has units', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 76 };
        const items = [item('i1', 'p1', 'Sopa', 2, 38)];
        ({ host, root } = await mountComposer({
            order, items, products: [product('p1', 'Sopa', 38)], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        expect(host.querySelector('[data-testid="mesa-sheet-producto-badge-p1"]')).toBeNull();
        const qty = host.querySelector('[data-testid="mesa-sheet-producto-cantidad-p1"]');
        expect(qty.textContent).toBe('2');
        const minus = host.querySelector('[data-testid="mesa-sheet-producto-menos-p1"]');
        const plus = host.querySelector('[data-testid="mesa-sheet-producto-p1"]');
        expect(minus.getAttribute('aria-label')).toBe('Quitar uno de Sopa');
        expect(plus.getAttribute('aria-label')).toBe('Agregar uno de Sopa');
        expect(minus.className).toContain('touch-target-coarse');
        expect(plus.className).toContain('touch-target-coarse');
        // Visible: no ancestor hides it.
        expect(minus.closest('.hidden, .invisible')).toBeNull();
        expect(qty.closest('.hidden, .invisible')).toBeNull();
        expect(host.querySelector('[data-testid="mesa-sheet-producto-nombre-p1"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="mesa-sheet-producto-fila-p1"]')).not.toBeNull();
    });

    it('UX-13 reserves the stepper space without showing it when there are no units', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 0 };
        ({ host, root } = await mountComposer({
            order, items: [], products: [product('p1', 'Sopa', 38)], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        expect(host.querySelector('[data-testid="mesa-sheet-producto-badge-p1"]')).toBeNull();
        const qty = host.querySelector('[data-testid="mesa-sheet-producto-cantidad-p1"]');
        expect(qty.textContent).toBe('0');
        // Same height as with units (no layout jump), but invisible and unfocusable.
        expect(qty.closest('.invisible')).not.toBeNull();
        expect(qty.closest('.hidden')).toBeNull();
    });

    it('UX-13 the + and - buttons reuse the draft callbacks and never trigger the card add twice', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 76 };
        const items = [item('i1', 'p1', 'Sopa', 2, 38)];
        const onAddProduct = jest.fn();
        const onRemoveProduct = jest.fn();
        const p1 = product('p1', 'Sopa', 38);
        ({ host, root } = await mountComposer({
            order, items, products: [p1], showKitchen: true, testIdPrefix: 'mesa-sheet', onAddProduct, onRemoveProduct,
        }));

        await act(async () => host.querySelector('[data-testid="mesa-sheet-producto-p1"]').click());
        expect(onAddProduct).toHaveBeenCalledTimes(1);
        expect(onAddProduct).toHaveBeenCalledWith(p1);
        await act(async () => host.querySelector('[data-testid="mesa-sheet-producto-menos-p1"]').click());
        expect(onRemoveProduct).toHaveBeenCalledTimes(1);
        expect(onRemoveProduct.mock.calls[0][1].id).toBe('i1');
        expect(onAddProduct).toHaveBeenCalledTimes(1);

        // Tapping the card still adds one.
        await act(async () => host.querySelector('[data-testid="mesa-sheet-producto-nombre-p1"]').click());
        expect(onAddProduct).toHaveBeenCalledTimes(2);
    });

    it('UX-13 the card stepper only removes draft lines: sent units disable the minus', async () => {
        const order = { id: 'o1', order_number: 9, status: 'en_preparacion', total: 76 };
        const items = [item('i1', 'p1', 'Sopa', 2, 38, 'pendiente')];
        const onRemoveProduct = jest.fn();
        ({ host, root } = await mountComposer({
            order, items, products: [product('p1', 'Sopa', 38)], showKitchen: true, testIdPrefix: 'mesa-sheet', onRemoveProduct,
        }));

        const minus = host.querySelector('[data-testid="mesa-sheet-producto-menos-p1"]');
        expect(host.querySelector('[data-testid="mesa-sheet-producto-cantidad-p1"]').textContent).toBe('2');
        expect(minus.disabled).toBe(true);
        expect(host.querySelector('[data-testid="mesa-sheet-producto-p1"]').disabled).toBe(false);
    });

    it('UX-13 an unavailable product has no usable +', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 0 };
        ({ host, root } = await mountComposer({
            order, items: [], products: [{ ...product('p1', 'Sopa', 38), is_available: false }], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        expect(host.querySelector('[data-testid="mesa-sheet-producto-p1"]').disabled).toBe(true);
    });

    it('S3-2 el primer envío lleva el total de la comanda', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 76 };
        const items = [item('i1', 'p1', 'Sopa', 2, 38)];
        ({ host, root } = await mountComposer({
            order, items, products: [product('p1', 'Sopa', 38)], showKitchen: true, testIdPrefix: 'nuevo-pedido',
        }));

        const send = host.querySelector('[data-testid="nuevo-pedido-enviar-cocina"]');
        expect(send).not.toBeNull();
        expect(send.textContent).toContain('Enviar a cocina');
        expect(send.textContent).toContain('S/ 76.00');
    });

    it('S3-2 en adicionales suma sólo lo nuevo, no lo ya enviado', async () => {
        const order = { id: 'o1', order_number: 9, status: 'en_preparacion', total: 86 };
        const items = [
            item('i1', 'p1', 'Sopa', 2, 38, 'pendiente'), // ya salió a cocina
            item('i2', 'p2', 'Agua', 1, 10, 'borrador'),  // lo que se manda ahora
        ];
        ({ host, root } = await mountComposer({
            order, items, products: [product('p1', 'Sopa', 38), product('p2', 'Agua', 10)], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        // S9b: el mockup no usa "adicionales (N)"; el monto sigue siendo el de
        // lo que viaja ahora (no el total de la cuenta).
        const send = host.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(send.textContent).toContain('Enviar a cocina');
        expect(send.textContent).toContain('S/ 10.00');
        expect(send.textContent).not.toContain('S/ 86.00');
    });
});

describe('compositor · nota general para cocina (S3-3)', () => {
    let host;
    let root;

    beforeEach(() => {
        api.patch.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    const baseOrder = (extra = {}) => ({ id: 'o1', order_number: 9, status: 'nuevo', total: 38, notes: null, ...extra });

    const setValue = async (field, value) => {
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(field, value);
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    it('prefila la nota del pedido y la guarda al salir del campo', async () => {
        ({ host, root } = await mountComposer({
            order: baseOrder({ notes: 'Sin sal' }), items: [], products: [], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        const field = host.querySelector('[data-testid="mesa-sheet-nota-general"]');
        expect(field).not.toBeNull();
        expect(field.value).toBe('Sin sal');

        await setValue(field, 'Con hielo');
        await act(async () => {
            field.focus();
            field.blur();
        });
        expect(api.patch).toHaveBeenCalledWith('/orders/o1/notes', { notes: 'Con hielo' });
    });

    it('guarda con Enter sin Shift y respeta el salto de línea con Shift', async () => {
        ({ host, root } = await mountComposer({
            order: baseOrder(), items: [], products: [], showKitchen: true, testIdPrefix: 'nuevo-pedido',
        }));

        const field = host.querySelector('[data-testid="nuevo-pedido-nota-general"]');
        await setValue(field, 'Mesa junto a la ventana');

        await act(async () => {
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        });
        expect(api.patch).not.toHaveBeenCalled();

        await act(async () => {
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(api.patch).toHaveBeenCalledWith('/orders/o1/notes', { notes: 'Mesa junto a la ventana' });
    });

    it('limpiar el campo borra la nota y no guarda si nada cambió', async () => {
        ({ host, root } = await mountComposer({
            order: baseOrder({ notes: 'Vieja' }), items: [], products: [], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        const field = host.querySelector('[data-testid="mesa-sheet-nota-general"]');
        // Sin cambios: salir del campo no dispara ninguna llamada.
        await act(async () => {
            field.focus();
            field.blur();
        });
        expect(api.patch).not.toHaveBeenCalled();

        await setValue(field, '   ');
        await act(async () => {
            field.focus();
            field.blur();
        });
        expect(api.patch).toHaveBeenCalledWith('/orders/o1/notes', { notes: '' });
    });

    it('revierte el texto si el guardado falla', async () => {
        api.patch.mockRejectedValueOnce({ response: { data: { detail: 'Pedido cerrado' } } });
        ({ host, root } = await mountComposer({
            order: baseOrder({ notes: 'Previa' }), items: [], products: [], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        const field = host.querySelector('[data-testid="mesa-sheet-nota-general"]');
        await setValue(field, 'Nueva');
        await act(async () => {
            field.focus();
            field.blur();
        });

        expect(api.patch).toHaveBeenCalledWith('/orders/o1/notes', { notes: 'Nueva' });
        expect(field.value).toBe('Previa');
        expect(toast.error).toHaveBeenCalledWith('Pedido cerrado');
    });
});
