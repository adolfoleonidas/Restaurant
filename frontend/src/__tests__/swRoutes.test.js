import { NAVIGATION_DENYLIST, shouldCachePublicApi } from '../lib/swRoutes';

/**
 * Reglas de enrutado del service worker (`src/service-worker.js`), extraídas a un
 * módulo puro para poder probarlas: el service worker en sí no corre en Jest.
 */
describe('qué peticiones públicas puede guardar el service worker', () => {
    const cache = (pathname, method = 'GET') => shouldCachePublicApi({ request: { method }, url: { pathname } });

    it('la carta pública sí se cachea (red primero, 5 minutos)', () => {
        expect(cache('/api/public/menu')).toBe(true);
        expect(cache('/api/public/tables')).toBe(true);
    });

    it('el seguimiento del pedido nunca se guarda: el cliente no puede ver un estado viejo', () => {
        expect(cache('/api/public/orders/ABC123')).toBe(false);
        expect(cache('/api/public/orders/ABC123/table')).toBe(false);
    });

    it('la sesión de mesa nunca se guarda', () => {
        expect(cache('/api/public/tables/session')).toBe(false);
    });

    it('el stream SSE y los métodos que escriben quedan fuera', () => {
        expect(cache('/api/public/stream')).toBe(false);
        expect(cache('/api/public/menu', 'POST')).toBe(false);
    });

    it('lo que no es API pública no es asunto de esta regla', () => {
        expect(cache('/api/orders')).toBe(false);
    });
});

describe('navegaciones que el service worker no debe resolver con el index.html', () => {
    const denied = (path) => NAVIGATION_DENYLIST.some((re) => re.test(path));

    it('la API y la página de rescate se sirven tal cual', () => {
        expect(denied('/api/orders')).toBe(true);
        expect(denied('/reset-sw.html')).toBe(true);
        expect(denied('/reset-sw.html?x=1')).toBe(true);
    });

    it('las rutas de la SPA siguen resolviéndose con el index.html', () => {
        expect(denied('/menu')).toBe(false);
        expect(denied('/caja')).toBe(false);
        expect(denied('/')).toBe(false);
    });
});
