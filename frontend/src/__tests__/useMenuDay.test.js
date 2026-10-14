/**
 * El núcleo de la pantalla «Hoy»: leer el día y las cuatro mutaciones.
 *
 * Se prueba con un componente sonda y `createRoot` —el patrón de este repo— y no
 * con `renderHook`, que aquí revienta por cómo está montado React en Jest.
 *
 * Lo que se fija es de dónde sale el estado después de cada cambio: la pantalla
 * usa la respuesta del servidor en vez de recomponerla a mano, porque el servidor
 * es quien sabe qué queda ofrecido de verdad (carta fija, agotados, precio del
 * día). Adivinarlo en el cliente serían dos verdades que se separan al primer
 * caso raro.
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

import { copyMenuFrom, getMenuDay, saveMenuDay, setMenuSoldOut } from '@/lib/api/menu';
import useMenuDay from '@/pages/menu/useMenuDay';

const DIA = {
    date: '2026-03-10',
    status: 'draft',
    published: false,
    has_menu: true,
    selection: [{ product_id: 'p1', price: null, sold_out: false }],
    catalog: [{ product_id: 'p1', name: 'Arroz con pollo', offered_today: true, today_price: 12 }],
};

let latest = null;

function Probe({ date }) {
    latest = useMenuDay(date);
    return <div data-testid="probe">{latest.loading ? 'cargando' : (latest.error || latest.data?.date || '')}</div>;
}

async function mount(date) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Probe date={date} />); await Promise.resolve(); });
    return { container, root };
}

describe('useMenuDay', () => {
    beforeEach(() => {
        latest = null;
        getMenuDay.mockResolvedValue({ data: DIA });
        saveMenuDay.mockResolvedValue({ data: { ...DIA, status: 'published', published: true } });
        setMenuSoldOut.mockResolvedValue({ data: { ok: true } });
        copyMenuFrom.mockResolvedValue({ data: { ...DIA, copied: 2, copied_from: '2026-03-09' } });
    });

    afterEach(() => { document.body.innerHTML = ''; });

    it('carga el día al montar', async () => {
        const { container, root } = await mount('2026-03-10');
        expect(container.textContent).toContain('2026-03-10');
        expect(getMenuDay).toHaveBeenCalledWith('2026-03-10');
        expect(latest.error).toBeNull();
        await act(async () => root.unmount());
    });

    it('un fallo de carga se cuenta, no se queda cargando para siempre', async () => {
        getMenuDay.mockRejectedValue({ response: { data: { detail: 'Sin conexión con el servidor' } } });
        const { container, root } = await mount('2026-03-10');
        expect(container.textContent).toContain('Sin conexión con el servidor');
        expect(latest.data).toBeNull();
        await act(async () => root.unmount());
    });

    it('guardar toma el estado que devuelve el servidor, no uno adivinado', async () => {
        const { root } = await mount('2026-03-10');
        await act(async () => { await latest.save([{ product_id: 'p1' }], true); });

        expect(saveMenuDay).toHaveBeenCalledWith({
            date: '2026-03-10',
            items: [{ product_id: 'p1' }],
            publish: true,
        });
        // Publicar lo dice el servidor: la pantalla no lo deduce del argumento.
        expect(latest.data.published).toBe(true);
        expect(latest.saving).toBe(false);
        await act(async () => root.unmount());
    });

    it('agotar recarga, porque el estado efectivo lo decide el servidor', async () => {
        const { root } = await mount('2026-03-10');
        getMenuDay.mockClear();
        await act(async () => { await latest.toggleSoldOut('p1', true); });

        expect(setMenuSoldOut).toHaveBeenCalledWith({ date: '2026-03-10', product_id: 'p1', sold_out: true });
        expect(getMenuDay).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('copiar deja claro de dónde vino y cuántos platos trajo', async () => {
        const { root } = await mount('2026-03-10');
        await act(async () => { await latest.copyFrom('2026-03-09'); });

        expect(copyMenuFrom).toHaveBeenCalledWith({ date: '2026-03-10', from_date: '2026-03-09' });
        expect(latest.data.copied).toBe(2);
        await act(async () => root.unmount());
    });
});
