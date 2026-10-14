/**
 * «Gestionar menú»: el armazón que une el estado (useMenuDay) y la vista.
 *
 * Lo que se fija aquí es lo que puede costar dinero o tiempo:
 *
 * * publicar manda la selección **editada en local**, no la que vino del servidor
 *   (si no, montar el menú del día no serviría de nada);
 * * guardar borrador **no** publica;
 * * copiar de otro día pide la fecha en vez de inventarla;
 * * un fallo se cuenta en vez de dejar «Cargando…» para siempre.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/menu', () => ({
    __esModule: true,
    getMenuDay: jest.fn(),
    saveMenuDay: jest.fn(),
    setMenuSoldOut: jest.fn(),
    copyMenuFrom: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api/products', () => ({
    __esModule: true,
    updateProduct: jest.fn(() => Promise.resolve({ data: {} })),
}));

import { copyMenuFrom, getMenuDay, saveMenuDay, setMenuSoldOut } from '@/lib/api/menu';
import { updateProduct } from '@/lib/api/products';
import { toast } from 'sonner';
import { waitFor } from '@testing-library/react';
import GestionarMenu from '@/pages/menu/GestionarMenu';

const DIA = {
    date: '2026-03-10',
    status: 'draft',
    published: false,
    has_menu: true,
    selection: [{ product_id: 'p1', price: null, sold_out: false }],
    catalog: [
        { product_id: 'p1', name: 'Arroz con pollo', base_price: 12, today_price: 12, is_fixed: false, offered_today: true, sold_out: false },
        { product_id: 'p2', name: 'Inca Kola', base_price: 6, today_price: 6, is_fixed: true, offered_today: true, sold_out: false },
        { product_id: 'p3', name: 'Ceviche', base_price: 38, today_price: 38, is_fixed: false, offered_today: false, sold_out: false },
    ],
};

async function render() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<GestionarMenu />); await Promise.resolve(); });
    return { container, root };
}

const click = async (node) => {
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
};

describe('GestionarMenu', () => {
    beforeEach(() => {
        // El mock distingue fechas: si devolviera lo mismo para todas, el test de la
        // semana no podría comprobar el estado de cada día (y pasaría sin probar nada).
        getMenuDay.mockImplementation((fecha) => Promise.resolve({
            data: fecha === '2026-03-12'
                ? { ...DIA, date: fecha, has_menu: false, published: false, selection: [] }
                : { ...DIA, date: fecha || '2026-03-10' },
        }));
        saveMenuDay.mockResolvedValue({ data: { ...DIA, status: 'published', published: true } });
        setMenuSoldOut.mockResolvedValue({ data: { ok: true } });
        copyMenuFrom.mockResolvedValue({ data: { ...DIA, copied: 2, copied_from: '2026-03-09' } });
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('muestra el catálogo del día y el resumen de lo que se ofrece', async () => {
        const { container, root } = await render();
        expect(container.querySelector('[data-testid="menu-day-tarjetas"]')).not.toBeNull();
        // p1 y p2 (fija) se ofrecen; p3 no.
        expect(container.querySelector('[data-testid="menu-day-resumen"]').textContent).toContain('2 de 3');
        await act(async () => root.unmount());
    });

    it('publicar manda la selección editada, no la que vino del servidor', async () => {
        const { container, root } = await render();
        // El dueño añade el ceviche al menú de hoy…
        await click(container.querySelector('[data-testid="menu-ofrecer-p3"]'));
        // …y publica.
        await click(container.querySelector('[data-testid="menu-publicar"]'));

        const enviado = saveMenuDay.mock.calls[0][0];
        expect(enviado.publish).toBe(true);
        // La Inca Kola (p2) NO viaja, y es lo correcto: es carta fija, se ofrece por
        // su propia bandera. Meterla en el menú del día la ataría a hoy, que es justo
        // lo que la carta fija evita.
        expect(enviado.items.map((i) => i.product_id).sort()).toEqual(['p1', 'p3']);
        expect(toast.success).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('quitar del menú de hoy también viaja al publicar', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-ofrecer-p1"]'));
        await click(container.querySelector('[data-testid="menu-publicar"]'));

        // Hoy no se ofrece nada en especial: queda solo la carta fija, que no se
        // lista porque no depende del día.
        expect(saveMenuDay.mock.calls[0][0].items).toEqual([]);
        await act(async () => root.unmount());
    });

    it('guardar borrador no publica', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-guardar"]'));
        expect(saveMenuDay.mock.calls[0][0].publish).toBe(false);
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('borrador'));
        await act(async () => root.unmount());
    });

    it('copiar pide la fecha en vez de inventarla', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-copiar"]'));
        expect(copyMenuFrom).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Elige de qué día copiar');

        const input = container.querySelector('[data-testid="menu-copiar-desde"]');
        await act(async () => {
            // Los inputs controlados de React necesitan el setter nativo.
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '2026-03-09');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(container.querySelector('[data-testid="menu-copiar"]'));
        expect(copyMenuFrom).toHaveBeenCalledWith({ date: undefined, from_date: '2026-03-09' });
        await act(async () => root.unmount());
    });

    it('agotar avisa y deja claro que los pedidos tomados siguen', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-agotar-p1"]'));
        expect(setMenuSoldOut).toHaveBeenCalledWith({ date: undefined, product_id: 'p1', sold_out: true });
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('siguen'));
        await act(async () => root.unmount());
    });

    it('el precio editado viaja, y el que no se toca va sin precio', async () => {
        const { container, root } = await render();
        const input = container.querySelector('[data-testid="menu-precio-p1"]');
        expect(input).not.toBeNull();

        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '9.5');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(container.querySelector('[data-testid="menu-publicar"]'));

        const items = saveMenuDay.mock.calls[0][0].items;
        // El tocado lleva su precio nuevo…
        expect(items.find((i) => i.product_id === 'p1').price).toBe(9.5);
        // …y el que no se tocó va SIN precio, para que siga el del catálogo. Mandar
        // el que se muestra lo congelaría solo para hoy.
        expect(items.find((i) => i.product_id === 'p2')).toBeUndefined();
        await act(async () => root.unmount());
    });

    it('borrar el precio vuelve al del catálogo, no a cero', async () => {
        const { container, root } = await render();
        const input = container.querySelector('[data-testid="menu-precio-p1"]');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await click(container.querySelector('[data-testid="menu-publicar"]'));

        // `null` = «usa el del catálogo». Un 0 cobraría el plato gratis.
        expect(saveMenuDay.mock.calls[0][0].items.find((i) => i.product_id === 'p1').price).toBeNull();
        await act(async () => root.unmount());
    });

    it('la pestaña Catálogo marca la carta fija y recarga', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-tab-catalog"]'));
        expect(container.querySelector('[data-testid="menu-catalogo"]')).not.toBeNull();

        // p3 es «del día»: al pulsar pasa a carta fija.
        await click(container.querySelector('[data-testid="menu-fija-p3"]'));
        await waitFor(() => expect(updateProduct).toHaveBeenCalledWith('p3', { is_fixed: true }));
        // El estado efectivo lo dice el servidor: se recarga en vez de adivinarlo.
        await waitFor(() => expect(getMenuDay.mock.calls.length).toBeGreaterThan(1));
        await act(async () => root.unmount());
    });

    it('y quitarla de carta fija también', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-tab-catalog"]'));
        await click(container.querySelector('[data-testid="menu-fija-p2"]'));
        await waitFor(() => expect(updateProduct).toHaveBeenCalledWith('p2', { is_fixed: false }));
        await act(async () => root.unmount());
    });

    it('la semana lista los siete días con su estado y deja abrir uno', async () => {
        // El «hoy» lo dice el servidor: la primera carga devuelve 2026-03-10.
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-tab-week"]'));

        await waitFor(() => expect(container.querySelector('[data-testid="menu-dia-2026-03-10"]')).not.toBeNull());
        // Siete días contando desde el de hoy, no ocho ni seis.
        expect(container.querySelectorAll('[data-testid^="menu-dia-2026-"]').length).toBe(7);
        expect(container.querySelector('[data-testid="menu-dia-estado-2026-03-10"]').textContent).toBe('Borrador');
        expect(container.querySelector('[data-testid="menu-dia-estado-2026-03-12"]').textContent).toBe('Sin menú');

        // Abrir un día cambia la fecha de trabajo de TODA la pantalla.
        getMenuDay.mockClear();
        await click(container.querySelector('[data-testid="menu-dia-abrir-2026-03-12"]'));
        expect(container.querySelector('[data-testid="menu-dia-abierto"]').textContent).toContain('2026-03-12');
        await waitFor(() => expect(getMenuDay).toHaveBeenCalledWith('2026-03-12'));

        // Y se puede volver a hoy.
        await click(container.querySelector('[data-testid="menu-volver-hoy"]'));
        expect(container.querySelector('[data-testid="menu-dia-abierto"]')).toBeNull();
        await act(async () => root.unmount());
    });

    it('la semana avisa de que programar no es repetir', async () => {
        const { container, root } = await render();
        await click(container.querySelector('[data-testid="menu-tab-week"]'));
        expect(container.querySelector('[data-testid="menu-semana"]').textContent).toContain('no repite todas las semanas');
        await act(async () => root.unmount());
    });

    it('un fallo de carga se cuenta, no se queda cargando para siempre', async () => {
        getMenuDay.mockRejectedValue({ response: { data: { detail: 'Sin conexión' } } });
        const { container, root } = await render();
        expect(container.querySelector('[data-testid="menu-error"]').textContent).toBe('Sin conexión');
        expect(container.querySelector('[data-testid="menu-cargando"]')).toBeNull();
        await act(async () => root.unmount());
    });
});
