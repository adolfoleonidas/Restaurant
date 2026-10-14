/**
 * Las lecturas idénticas que ya viajan se comparten.
 *
 * Medido en el teléfono del mozo: al abrir el Salón la app pedía dos y tres veces
 * la misma lista (`/api/orders?active_only=true`, 12 KB) en paralelo, y las
 * peticiones se encolaban entre ellas — una respuesta de 0 KB
 * (`/api/categories`) tardaba 300-536 ms porque había cinco en vuelo.
 *
 * Esto es la clase de problema, no un caso: una regla en la capa de red que quita
 * las peticiones repetidas sin tocar una sola pantalla.
 */
import { get, post } from '@/lib/api/request';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    API: 'http://test/api',
    api: {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
    },
}));

describe('lecturas que ya están en vuelo', () => {
    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
    });

    it('varias pantallas pidiendo lo mismo a la vez: una sola petición', async () => {
        let release;
        api.get.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ data: [1, 2, 3] });
        }));

        const calls = [get('/orders', { params: { active_only: true } }), get('/orders', { params: { active_only: true } }), get('/orders', { params: { active_only: true } })];
        expect(api.get).toHaveBeenCalledTimes(1);

        release();
        const results = await Promise.all(calls);
        expect(api.get).toHaveBeenCalledTimes(1);
        results.forEach((response) => expect(response.data).toEqual([1, 2, 3]));
    });

    it('no es una caché: cuando termina, la próxima vuelve a pedir', async () => {
        api.get.mockResolvedValue({ data: [] });

        await get('/tables');
        await get('/tables');

        // Una pantalla que se abre después no lee datos viejos.
        expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('parámetros distintos son peticiones distintas', async () => {
        api.get.mockResolvedValue({ data: [] });

        await Promise.all([
            get('/orders', { params: { active_only: true } }),
            get('/orders', { params: { active_only: true, limit: 80 } }),
            get('/orders'),
        ]);

        expect(api.get).toHaveBeenCalledTimes(3);
    });

    it('un fallo no se queda pegado: la próxima intenta de nuevo', async () => {
        api.get.mockRejectedValueOnce(new Error('sin red'));
        await expect(get('/tables')).rejects.toThrow('sin red');

        api.get.mockResolvedValueOnce({ data: [{ id: 't1' }] });
        const response = await get('/tables');

        expect(response.data).toEqual([{ id: 't1' }]);
        expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('escribir nunca se comparte, aunque sea lo mismo dos veces', async () => {
        api.post.mockResolvedValue({ data: {} });

        await Promise.all([post('/orders', { a: 1 }), post('/orders', { a: 1 })]);

        expect(api.post).toHaveBeenCalledTimes(2);
    });

    it('una lectura fuera de la lista no se comparte: hay pantallas que piden dos veces a propósito', async () => {
        // El catálogo de sucursales y los reportes piden lo mismo dos veces para
        // poder descartar la respuesta vieja. Compartir ahí le daría a la segunda
        // justo el resultado que quiere ignorar.
        let releases = [];
        api.get.mockImplementation(() => new Promise((resolve) => {
            releases.push(resolve);
        }));

        const calls = [get('/branches', { params: { scope: 'a' } }), get('/branches', { params: { scope: 'a' } })];
        expect(api.get).toHaveBeenCalledTimes(2);

        releases.forEach((release, index) => release({ data: [{ id: index }] }));
        const results = await Promise.all(calls);
        expect(results[0].data).toEqual([{ id: 0 }]);
        expect(results[1].data).toEqual([{ id: 1 }]);
    });
});
