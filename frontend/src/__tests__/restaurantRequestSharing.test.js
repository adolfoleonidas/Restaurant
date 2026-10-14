/**
 * La configuración del local se pide UNA vez aunque la pidan cuatro pantallas.
 *
 * Medido en el teléfono del mozo: al abrir el Salón salían tres o cuatro
 * peticiones idénticas de 1 KB a `/restaurants/current` en paralelo, y cada una
 * tardaba 400-670 ms porque se pisaban en el enlace (mientras `/api/tables`
 * devolvía 4-6 KB en 157 ms). El costo no era el endpoint: era pedirlo de más.
 */
import { getRestaurant, updateRestaurant } from '@/lib/api/restaurant';
import { get, patch } from '@/lib/api/request';

jest.mock('@/lib/api/request', () => ({
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
}));

describe('la configuración del local', () => {
    beforeEach(() => {
        get.mockReset();
        patch.mockReset();
    });

    it('comparte la petición cuando varias pantallas la piden a la vez', async () => {
        let release;
        get.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ data: { name: 'Mi Resto' } });
        }));

        // Cuatro pantallas montando en el mismo tick, como en el Salón real.
        const calls = [getRestaurant(), getRestaurant(), getRestaurant(), getRestaurant()];
        expect(get).toHaveBeenCalledTimes(1);

        release();
        const results = await Promise.all(calls);

        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/restaurants/current');
        results.forEach((result) => expect(result.data.name).toBe('Mi Resto'));
    });

    it('vuelve a pedirla cuando la anterior ya terminó', async () => {
        get.mockResolvedValue({ data: { name: 'Mi Resto' } });

        await getRestaurant();
        await getRestaurant();

        // Sin caché: una pantalla que se abre más tarde no lee datos viejos.
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('un fallo no se queda pegado: la próxima intenta de nuevo', async () => {
        get.mockRejectedValueOnce(new Error('sin red'));
        await expect(getRestaurant()).rejects.toThrow('sin red');

        get.mockResolvedValueOnce({ data: { name: 'Mi Resto' } });
        const result = await getRestaurant();

        expect(result.data.name).toBe('Mi Resto');
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('guardar la configuración sigue siendo un PATCH', async () => {
        patch.mockResolvedValue({ data: {} });
        await updateRestaurant({ name: 'Otro' });
        expect(patch).toHaveBeenCalledWith('/restaurants/current', { name: 'Otro' });
    });
});
