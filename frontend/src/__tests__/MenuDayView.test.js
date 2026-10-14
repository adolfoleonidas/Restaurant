/**
 * El catálogo del día en tarjetas o en lista.
 *
 * Lo que se fija aquí: que las dos vistas ofrezcan **los mismos controles** (una
 * lista que solo se mira no sirve para editar el inventario, que es para lo que se
 * pidió) y que los botones devuelvan la intención correcta, incluido lo que NO se
 * puede hacer: un plato de carta fija no se «quita de hoy» porque se ofrece
 * siempre, y un plato que hoy no se ofrece no se puede agotar.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import MenuDayView from '@/pages/menu/MenuDayView';

global.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOGO = [
    { product_id: 'p1', name: 'Arroz con pollo', base_price: 12, today_price: 12, is_fixed: false, offered_today: true, sold_out: false },
    { product_id: 'p2', name: 'Inca Kola', base_price: 6, today_price: 6, is_fixed: true, offered_today: true, sold_out: false },
    { product_id: 'p3', name: 'Ceviche', base_price: 38, today_price: 38, is_fixed: false, offered_today: false, sold_out: false },
    { product_id: 'p4', name: 'Suspiro', base_price: 14, today_price: 14, is_fixed: false, offered_today: true, sold_out: true },
];

async function render(props = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<MenuDayView catalog={CATALOGO} {...props} />);
        await Promise.resolve();
    });
    return { container, root };
}

const click = async (node) => {
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

describe('MenuDayView', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('en tarjetas muestra el resumen y un bloque por plato', async () => {
        const { container, root } = await render({ mode: 'cards' });
        expect(container.querySelector('[data-testid="menu-day-tarjetas"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="menu-day-lista"]')).toBeNull();
        // 3 se ofrecen (p1, p2, p4) de 4.
        expect(container.querySelector('[data-testid="menu-day-resumen"]').textContent).toContain('3 de 4');
        await act(async () => root.unmount());
    });

    it('en lista muestra las filas y conserva los dos controles', async () => {
        const { container, root } = await render({ mode: 'list' });
        expect(container.querySelector('[data-testid="menu-day-lista"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="menu-day-tarjetas"]')).toBeNull();
        expect(container.querySelector('[data-testid="menu-fila-p1"]')).not.toBeNull();
        // Los mismos botones que en la tarjeta: la lista también edita.
        expect(container.querySelector('[data-testid="menu-ofrecer-p1"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="menu-agotar-p1"]')).not.toBeNull();
        await act(async () => root.unmount());
    });

    it('el conmutador avisa del cambio de vista', async () => {
        const onModeChange = jest.fn();
        const { container, root } = await render({ mode: 'cards', onModeChange });
        await click(container.querySelector('[data-testid="menu-vista-lista"]'));
        expect(onModeChange).toHaveBeenCalledWith('list');
        await act(async () => root.unmount());
    });

    it('quitar de hoy devuelve la intención con el estado contrario', async () => {
        const onToggleOffered = jest.fn();
        const { container, root } = await render({ onToggleOffered });
        await click(container.querySelector('[data-testid="menu-ofrecer-p1"]'));
        expect(onToggleOffered).toHaveBeenCalledWith('p1', false);

        // p3 no se ofrece hoy: el botón ofrece, no quita.
        await click(container.querySelector('[data-testid="menu-ofrecer-p3"]'));
        expect(onToggleOffered).toHaveBeenLastCalledWith('p3', true);
        await act(async () => root.unmount());
    });

    it('un plato de carta fija no se quita de hoy', async () => {
        // Se ofrece siempre: sacarlo del día no significaría nada, así que el botón
        // no se ofrece en vez de mandar una orden que el servidor va a ignorar.
        const onToggleOffered = jest.fn();
        const { container, root } = await render({ onToggleOffered });
        expect(container.querySelector('[data-testid="menu-ofrecer-p2"]').disabled).toBe(true);
        await act(async () => root.unmount());
    });

    it('un plato que hoy no se ofrece no se puede agotar', async () => {
        const onToggleSoldOut = jest.fn();
        const { container, root } = await render({ onToggleSoldOut });
        expect(container.querySelector('[data-testid="menu-agotar-p3"]').disabled).toBe(true);
        // Y uno que sí se ofrece, sí.
        await click(container.querySelector('[data-testid="menu-agotar-p1"]'));
        expect(onToggleSoldOut).toHaveBeenCalledWith('p1', true);
        await act(async () => root.unmount());
    });

    it('marca varios y los aplica de una vez', async () => {
        // Montar el menú de un día es «estos diez sí, estos no»: sin esto habría que
        // pulsar plato por plato, que es justo lo que se quería evitar.
        const onBulkOffer = jest.fn();
        const { container, root } = await render({ onBulkOffer });

        expect(container.querySelector('[data-testid="menu-bloque"]')).toBeNull();
        await click(container.querySelector('[data-testid="menu-marcar-p1"]'));
        await click(container.querySelector('[data-testid="menu-marcar-p3"]'));
        expect(container.querySelector('[data-testid="menu-bloque"]').textContent).toContain('2 seleccionados');

        await click(container.querySelector('[data-testid="menu-bloque-ofrecer"]'));
        expect(onBulkOffer).toHaveBeenCalledWith(['p1', 'p3'], true);
        // Tras aplicar, la selección se limpia: si no, el siguiente clic repetiría
        // el cambio sobre platos que ya no se están mirando.
        expect(container.querySelector('[data-testid="menu-bloque"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('también se puede quitar en bloque, y desmarcar sin tocar nada', async () => {
        const onBulkOffer = jest.fn();
        const { container, root } = await render({ onBulkOffer });
        await click(container.querySelector('[data-testid="menu-marcar-p1"]'));

        await click(container.querySelector('[data-testid="menu-bloque-quitar"]'));
        expect(onBulkOffer).toHaveBeenCalledWith(['p1'], false);

        await click(container.querySelector('[data-testid="menu-marcar-p1"]'));
        await click(container.querySelector('[data-testid="menu-bloque-limpiar"]'));
        expect(container.querySelector('[data-testid="menu-bloque"]')).toBeNull();
        expect(onBulkOffer).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });

    it('con la carta vacía lo dice en vez de quedarse en blanco', async () => {
        const { container, root } = await render({ catalog: [] });
        expect(container.querySelector('[data-testid="menu-day-vacio"]')).not.toBeNull();
        await act(async () => root.unmount());
    });
});
