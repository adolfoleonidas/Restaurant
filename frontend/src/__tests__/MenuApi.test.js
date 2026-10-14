/**
 * El contrato de URLs del menú del día.
 *
 * Estas rutas son las que el backend declara en `routes/menu.py`. Se fijan aquí
 * porque un renombrado en el servidor no rompe nada visible: la pantalla pediría
 * a una URL que ya no existe y el fallo aparecería como «no carga», que es la
 * clase de error que más tiempo cuesta encontrar.
 */
jest.mock('@/lib/api/request', () => ({
    __esModule: true,
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    withParams: (params) => (params ? { params } : undefined),
}));

import { get, post, put } from '@/lib/api/request';
import { copyMenuFrom, getMenuDay, saveMenuDay, setMenuSoldOut } from '@/lib/api/menu';

describe('cliente del menú del día', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('lee el día, y con fecha cuando se le pasa', async () => {
        await getMenuDay();
        expect(get).toHaveBeenCalledWith('/menu/day', undefined);

        await getMenuDay('2026-03-10');
        expect(get).toHaveBeenLastCalledWith('/menu/day', { params: { date: '2026-03-10' } });
    });

    it('guarda el día con PUT, que es lo que declara el backend', async () => {
        // Si esto fuera un POST, el guardado fallaría con 405 y el borrador nunca
        // se guardaría: la pantalla diría «guardado» sin haber guardado nada.
        await saveMenuDay({ date: '2026-03-10', items: [{ product_id: 'p1' }], publish: true });
        expect(put).toHaveBeenCalledWith('/menu/day', {
            date: '2026-03-10',
            items: [{ product_id: 'p1' }],
            publish: true,
        });
    });

    it('agotar y copiar van por su propia ruta', async () => {
        await setMenuSoldOut({ product_id: 'p1', sold_out: true });
        expect(post).toHaveBeenCalledWith('/menu/day/sold-out', { product_id: 'p1', sold_out: true });

        await copyMenuFrom({ date: '2026-03-10', from_date: '2026-03-09' });
        expect(post).toHaveBeenLastCalledWith('/menu/day/copy-from', {
            date: '2026-03-10',
            from_date: '2026-03-09',
        });
    });
});
