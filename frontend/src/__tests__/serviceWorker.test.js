import { registerServiceWorker } from '@/lib/serviceWorker';

/**
 * Registro con auto-update (S11): el service worker usa skipWaiting +
 * clientsClaim, así que la pestaña tiene que recargar UNA vez al cambiar el
 * controlador y pasar a la build nueva (antes quedaba pegada a la vieja).
 */
describe('registro del service worker', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalPublicUrl = process.env.PUBLIC_URL;
    let reload;
    let sw;

    /** navigator.serviceWorker falso; devuelve los handlers registrados. */
    function setupNavigator(controller = null) {
        const listeners = {};
        sw = {
            controller,
            register: jest.fn().mockResolvedValue({}),
            addEventListener: jest.fn((event, handler) => { listeners[event] = handler; }),
        };
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
        return listeners;
    }

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.PUBLIC_URL = '';
        reload = jest.fn();
        // jsdom no implementa la navegación: se reemplaza `location` por un doble.
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...window.location, reload },
        });
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        process.env.PUBLIC_URL = originalPublicUrl;
        delete navigator.serviceWorker;
    });

    it('en desarrollo no registra nada (evita el fantasma de una build vieja)', () => {
        process.env.NODE_ENV = 'development';
        setupNavigator();
        registerServiceWorker();
        window.dispatchEvent(new Event('load'));
        expect(sw.register).not.toHaveBeenCalled();
    });

    it('sin soporte de service worker no falla', () => {
        delete navigator.serviceWorker;
        expect(() => registerServiceWorker()).not.toThrow();
    });

    it('en producción registra al cargar y fuerza la revalidación del archivo', async () => {
        setupNavigator();
        registerServiceWorker();
        window.dispatchEvent(new Event('load'));
        await Promise.resolve();
        expect(sw.register).toHaveBeenCalledWith('/service-worker.js', { updateViaCache: 'none' });
    });

    it('una actualización recarga una única vez cuando cambia el controlador', () => {
        const listeners = setupNavigator({}); // ya había un service worker controlando
        registerServiceWorker();
        expect(listeners.controllerchange).toBeDefined();
        listeners.controllerchange();
        listeners.controllerchange();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('la primera visita no recarga: no había build vieja que reemplazar', () => {
        const listeners = setupNavigator(null);
        registerServiceWorker();
        listeners.controllerchange();
        expect(reload).not.toHaveBeenCalled();
    });

    describe('búsqueda de versiones nuevas con la app abierta', () => {
        // El navegador solo busca un service worker nuevo al navegar o cada 24 h:
        // una app que el mozo deja abierta todo el turno seguía en la build vieja.
        let registration;
        let visibility;

        async function registerWithUpdate() {
            setupNavigator({});
            registration = { update: jest.fn().mockResolvedValue(undefined) };
            sw.register.mockResolvedValue(registration);
            registerServiceWorker();
            window.dispatchEvent(new Event('load'));
            await Promise.resolve();
            await Promise.resolve();
        }

        function setVisibility(state) {
            visibility = state;
            document.dispatchEvent(new Event('visibilitychange'));
        }

        beforeEach(() => {
            jest.useFakeTimers();
            visibility = 'visible';
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => visibility,
            });
        });

        afterEach(() => {
            jest.useRealTimers();
            delete document.visibilityState;
        });

        it('al volver a primer plano pide al navegador que busque una versión nueva', async () => {
            await registerWithUpdate();
            setVisibility('hidden');
            expect(registration.update).not.toHaveBeenCalled();
            setVisibility('visible');
            expect(registration.update).toHaveBeenCalledTimes(1);
        });

        it('con la app abierta busca una versión nueva cada 15 minutos', async () => {
            await registerWithUpdate();
            jest.advanceTimersByTime(15 * 60 * 1000);
            expect(registration.update).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(15 * 60 * 1000);
            expect(registration.update).toHaveBeenCalledTimes(2);
        });

        it('en segundo plano no gasta datos buscando versiones', async () => {
            await registerWithUpdate();
            visibility = 'hidden';
            jest.advanceTimersByTime(15 * 60 * 1000);
            expect(registration.update).not.toHaveBeenCalled();
        });

        it('un fallo de red al buscar la versión no rompe la app', async () => {
            await registerWithUpdate();
            registration.update.mockRejectedValue(new Error('offline'));
            expect(() => setVisibility('visible')).not.toThrow();
            await Promise.resolve();
        });
    });
});
