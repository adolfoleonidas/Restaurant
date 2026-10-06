/**
 * Paridad del compositor de carta con el prototipo final (Slice 3):
 * - S3-1: badge de cantidad en la esquina superior de la tarjeta de producto.
 * - S3-2: el botón de envío lleva el total de lo que se manda.
 *
 * El compositor es compartido (Salón y Nuevo pedido): se monta solo, con el
 * prefijo de cada pantalla, para cubrir ambos contratos de testids.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OrderComposer from '@/components/OrderComposer';

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

    it('S3-1 muestra el badge de cantidad cuando hay unidades, sin tocar el stepper', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 76 };
        const items = [item('i1', 'p1', 'Sopa', 2, 38)];
        ({ host, root } = await mountComposer({
            order, items, products: [product('p1', 'Sopa', 38)], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        const badge = host.querySelector('[data-testid="mesa-sheet-producto-badge-p1"]');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('2');
        // Contratos del stepper intactos: cantidad, − y + siguen ahí.
        expect(host.querySelector('[data-testid="mesa-sheet-producto-cantidad-p1"]').textContent).toBe('2');
        expect(host.querySelector('[data-testid="mesa-sheet-producto-menos-p1"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="mesa-sheet-producto-p1"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="mesa-sheet-producto-nombre-p1"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="mesa-sheet-producto-fila-p1"]')).not.toBeNull();
    });

    it('S3-1 no muestra badge sin unidades', async () => {
        const order = { id: 'o1', order_number: 9, status: 'nuevo', total: 0 };
        ({ host, root } = await mountComposer({
            order, items: [], products: [product('p1', 'Sopa', 38)], showKitchen: true, testIdPrefix: 'mesa-sheet',
        }));

        expect(host.querySelector('[data-testid="mesa-sheet-producto-badge-p1"]')).toBeNull();
        expect(host.querySelector('[data-testid="mesa-sheet-producto-cantidad-p1"]').textContent).toBe('0');
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

        const send = host.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(send.textContent).toContain('Enviar adicionales (1)');
        expect(send.textContent).toContain('S/ 10.00');
        expect(send.textContent).not.toContain('S/ 86.00');
    });
});
