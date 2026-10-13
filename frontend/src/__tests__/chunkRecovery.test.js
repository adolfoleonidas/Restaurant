/**
 * Qué versión corre el teléfono (visible) y qué pasa cuando a la app le falta un
 * trozo.
 *
 * El caso real que originó esto: se desplegó una build nueva, el servidor borró
 * los archivos de la anterior, y un teléfono con la app vieja guardada por el
 * service worker siguió pidiendo esos archivos: 404 y pantallas a medias. Desde el
 * servidor no había forma de saber qué versión tenía el teléfono, así que ahora la
 * versión se lee en pantalla y, cuando falta un trozo, la app trae la build nueva
 * sola en lugar de quedarse rota.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import BuildStamp from '@/components/BuildStamp';
import { buildHash, buildLabel } from '@/lib/buildInfo';
import {
    CHUNK_RECOVERY_KEY, COOLDOWN_MS, MAX_RECOVERIES,
    installChunkRecovery, isChunkLoadFailure, recoveryAllowed, takeTheNewBuild,
} from '@/lib/chunkRecovery';
import { reloadWithPendingTaps } from '@/lib/reloadWithPendingTaps';

jest.mock('@/lib/reloadWithPendingTaps', () => ({
    reloadWithPendingTaps: jest.fn(() => Promise.resolve()),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const withScript = (src, fn) => {
    const script = document.createElement('script');
    script.setAttribute('src', src);
    document.head.appendChild(script);
    try { return fn(); } finally { script.remove(); }
};

describe('buildInfo: la versión se lee de la página, no se configura', () => {
    it('toma el hash del bundle principal que el navegador cargó', () => {
        withScript('/static/js/main.5d0ffa4b.js', () => {
            expect(buildHash(document)).toBe('5d0ffa4b');
            expect(buildLabel(document)).toBe('Versión 5d0ffa4b');
        });
    });

    it('los trozos no nombran la versión: solo el bundle principal', () => {
        withScript('/static/js/417.c86dfc63.chunk.js', () => {
            expect(buildHash(document)).toBe('');
        });
    });

    it('sin bundle reconocible lo dice en vez de inventar una versión', () => {
        withScript('/otra/cosa.js', () => {
            expect(buildHash(document)).toBe('');
            expect(buildLabel(document)).toBe('Versión desconocida');
        });
    });

    it('BuildStamp la muestra con su testid, para poder leerla desde el teléfono', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const script = document.createElement('script');
        script.setAttribute('src', '/static/js/main.5d0ffa4b.js');
        document.head.appendChild(script);

        await act(async () => { root.render(<BuildStamp prefix="login" />); });

        const stamp = host.querySelector('[data-testid="login-version"]');
        expect(stamp).not.toBeNull();
        expect(stamp.textContent).toBe('Versión 5d0ffa4b');

        await act(async () => { root.unmount(); });
        script.remove();
        host.remove();
    });
});

describe('isChunkLoadFailure: solo los fallos de un trozo que no se pudo traer', () => {
    it('reconoce lo que dicen webpack y el navegador', () => {
        expect(isChunkLoadFailure({ name: 'ChunkLoadError', message: 'Loading chunk 5 failed.' })).toBe(true);
        expect(isChunkLoadFailure(new Error('Loading chunk 417 failed. (missing: /static/js/417.9947db92.chunk.js)'))).toBe(true);
        expect(isChunkLoadFailure('Loading CSS chunk 2 failed.')).toBe(true);
        expect(isChunkLoadFailure({ reason: new Error('Failed to fetch dynamically imported module: /x.js') })).toBe(true);
    });

    it('no confunde un error normal de la pantalla con un trozo que falta', () => {
        expect(isChunkLoadFailure(new Error('boom de prueba'))).toBe(false);
        expect(isChunkLoadFailure({ message: 'No se pudo guardar la nota' })).toBe(false);
        expect(isChunkLoadFailure(null)).toBe(false);
        expect(isChunkLoadFailure(undefined)).toBe(false);
        expect(isChunkLoadFailure('')).toBe(false);
    });
});

describe('takeTheNewBuild: suelta la app vieja y recarga', () => {
    const makeWin = () => {
        const stored = new Map();
        const unregister = jest.fn(() => Promise.resolve(true));
        const del = jest.fn(() => Promise.resolve(true));
        return {
            sessionStorage: {
                getItem: (key) => (stored.has(key) ? stored.get(key) : null),
                setItem: (key, value) => stored.set(key, String(value)),
            },
            navigator: { serviceWorker: { getRegistrations: () => Promise.resolve([{ unregister }]) } },
            caches: { keys: () => Promise.resolve(['precache-v2', 'carta-publica']), delete: del },
            location: { reload: jest.fn() },
            listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; },
            removeEventListener: jest.fn(),
            _stored: stored,
            _unregister: unregister,
            _deletes: del,
        };
    };

    beforeEach(() => {
        reloadWithPendingTaps.mockClear();
    });

    it('suelta el service worker y su caché, y recarga llevándose los toques pendientes', async () => {
        const win = makeWin();

        const recovered = await takeTheNewBuild({ win, storage: win.sessionStorage, now: 1_000_000 });

        expect(recovered).toBe(true);
        // Sin esto no sirve de nada recargar: el service worker resolvería la
        // navegación con el index.html viejo, que apunta a archivos que ya no están.
        expect(win._unregister).toHaveBeenCalledTimes(1);
        expect(win._deletes).toHaveBeenCalledWith('precache-v2');
        expect(win._deletes).toHaveBeenCalledWith('carta-publica');
        expect(reloadWithPendingTaps).toHaveBeenCalledWith(win);
    });

    it('deja anotado el intento antes de recargar, para que una recarga que vuelve a fallar no entre en bucle', async () => {
        const win = makeWin();
        await takeTheNewBuild({ win, storage: win.sessionStorage, now: 1_000_000 });

        const state = JSON.parse(win._stored.get(CHUNK_RECOVERY_KEY));
        expect(state).toEqual({ count: 1, at: 1_000_000 });
        // Y por eso mismo, un segundo intento inmediato no se permite.
        await expect(takeTheNewBuild({ win, storage: win.sessionStorage, now: 1_000_100 })).resolves.toBe(false);
    });

    it('respeta la espera entre recargas y el tope por pestaña', async () => {
        const win = makeWin();
        let now = 5_000_000;
        const attempt = async () => {
            // eslint-disable-next-line no-await-in-loop
            const ok = await takeTheNewBuild({ win, storage: win.sessionStorage, now });
            now += COOLDOWN_MS;
            return ok;
        };

        expect(await attempt()).toBe(true);
        expect(await attempt()).toBe(true);
        // Tercera vez: ya se gastaron las recargas automáticas de esta pestaña.
        expect(await attempt()).toBe(false);
        expect(JSON.parse(win._stored.get(CHUNK_RECOVERY_KEY)).count).toBe(MAX_RECOVERIES);
    });

    it('sin ventana no hace nada (no revienta fuera del navegador)', async () => {
        await expect(takeTheNewBuild({ win: null })).resolves.toBe(false);
    });

    it('recoveryAllowed describe el límite por sí solo', () => {
        const stored = new Map([[CHUNK_RECOVERY_KEY, JSON.stringify({ count: 1, at: 1000 })]]);
        const storage = { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v) };
        expect(recoveryAllowed(storage, 1000 + COOLDOWN_MS)).toBe(true);
        expect(recoveryAllowed(storage, 1000 + COOLDOWN_MS - 1)).toBe(false);
        stored.set(CHUNK_RECOVERY_KEY, JSON.stringify({ count: MAX_RECOVERIES, at: 0 }));
        expect(recoveryAllowed(storage, 10 ** 9)).toBe(false);
    });
});

describe('installChunkRecovery: la app se arregla sola cuando le falta un trozo', () => {
    const makeWin = () => {
        const stored = new Map();
        return {
            sessionStorage: {
                getItem: (key) => (stored.has(key) ? stored.get(key) : null),
                setItem: (key, value) => stored.set(key, String(value)),
            },
            navigator: { serviceWorker: { getRegistrations: () => Promise.resolve([]) } },
            caches: { keys: () => Promise.resolve([]), delete: jest.fn() },
            location: { reload: jest.fn() },
            listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; },
            removeEventListener: jest.fn(),
        };
    };

    const flush = async () => {
        for (let i = 0; i < 8; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        reloadWithPendingTaps.mockClear();
    });

    it('una promesa rechazada por un trozo que falta dispara la recuperación', async () => {
        const win = makeWin();
        installChunkRecovery(win);

        win.listeners.unhandledrejection({ reason: { name: 'ChunkLoadError', message: 'Loading chunk 9 failed.' } });
        await flush();

        expect(reloadWithPendingTaps).toHaveBeenCalledTimes(1);
    });

    it('un error normal de la app no dispara una recarga', async () => {
        const win = makeWin();
        installChunkRecovery(win);

        win.listeners.error({ message: 'No se pudo guardar la nota', error: new Error('No se pudo guardar la nota') });
        win.listeners.unhandledrejection({ reason: new Error('algo del negocio falló') });
        await flush();

        expect(reloadWithPendingTaps).not.toHaveBeenCalled();
    });

    it('se puede desinstalar', async () => {
        const win = makeWin();
        const uninstall = installChunkRecovery(win);
        uninstall();

        expect(win.removeEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
        expect(win.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('sin ventana devuelve un desinstalador que no hace nada', () => {
        expect(() => installChunkRecovery(null)()).not.toThrow();
    });
});
