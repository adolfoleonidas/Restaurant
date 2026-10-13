/**
 * La app se rompió porque le falta un trozo.
 *
 * CRA carga cada pantalla bajo demanda (`/static/js/<n>.<hash>.chunk.js`). Cuando
 * el servidor recibe un despliegue, los archivos de la build anterior se borran:
 * un teléfono que quedó con la app vieja guardada por el service worker sigue
 * pidiendo esos archivos y recibe 404. La pantalla no carga, o carga a medias.
 *
 * Reintentar el trozo viejo no puede funcionar —ya no existe—, así que lo que
 * arregla es pasar a la build nueva. Y no basta con recargar: el service worker
 * resuelve CUALQUIER navegación con el `index.html` que tiene precacheado (ver
 * `src/service-worker.js`), o sea el viejo, que a su vez apunta a los archivos que
 * ya no están. Por eso se suelta el service worker y su caché antes de recargar.
 * Los toques sin guardar viajan primero (ver `lib/reloadWithPendingTaps`).
 *
 * Límites: como mucho `MAX_RECOVERIES` recargas automáticas por pestaña y nunca
 * dos antes de `COOLDOWN_MS`. Si el servidor estuviera sirviendo una app rota, el
 * límite evita un bucle de recargas y el ErrorBoundary muestra el error.
 */
import { reloadWithPendingTaps } from '@/lib/reloadWithPendingTaps';

export const CHUNK_RECOVERY_KEY = 'restaurant_chunk_recovery';
export const MAX_RECOVERIES = 2;
export const COOLDOWN_MS = 30 * 1000;

// Lo que webpack (y los navegadores) dicen cuando un trozo no se pudo traer.
const FAILURE_PATTERNS = [
    /Loading chunk \S+ failed/i,
    /Loading CSS chunk/i,
    /ChunkLoadError/i,
    /Failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /Importing a module script failed/i,
];

/** True when this failure is a piece of the app that could not be downloaded. */
export function isChunkLoadFailure(value) {
    if (!value) return false;
    const parts = [
        value.name,
        value.message,
        typeof value === 'string' ? value : '',
        value.reason?.name,
        value.reason?.message,
        value.error?.name,
        value.error?.message,
    ];
    const text = parts.filter(Boolean).join(' | ');
    return FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function readState(storage) {
    try {
        const raw = storage?.getItem?.(CHUNK_RECOVERY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return { count: Number(parsed?.count) || 0, at: Number(parsed?.at) || 0 };
    } catch {
        return { count: 0, at: 0 };
    }
}

function writeState(storage, state) {
    try {
        storage?.setItem?.(CHUNK_RECOVERY_KEY, JSON.stringify(state));
    } catch {
        /* sin almacenamiento: el límite se pierde, no la recuperación */
    }
}

/** Si todavía se permite una recarga automática (límite y espera). */
export function recoveryAllowed(storage, now = Date.now()) {
    const state = readState(storage);
    return state.count < MAX_RECOVERIES && now - state.at >= COOLDOWN_MS;
}

/** Suelta el service worker y su caché, que son los que sirven la app vieja. */
async function dropStaleShell(win) {
    try {
        const registrations = await win?.navigator?.serviceWorker?.getRegistrations?.();
        await Promise.all((registrations || []).map((reg) => reg.unregister().catch(() => {})));
    } catch {
        /* sin service worker no hay nada que soltar */
    }
    try {
        const keys = await win?.caches?.keys?.();
        await Promise.all((keys || []).map((key) => win.caches.delete(key).catch(() => {})));
    } catch {
        /* sin CacheStorage tampoco */
    }
}

/**
 * Deja la pestaña en la build que el servidor tiene ahora.
 *
 * Resuelve a `true` cuando recargó, y a `false` cuando ya no se permite otra
 * recarga automática en esta pestaña (el límite de arriba).
 */
export async function takeTheNewBuild({
    win = typeof window === 'undefined' ? null : window,
    storage = win?.sessionStorage,
    now = Date.now(),
    reload = () => reloadWithPendingTaps(win),
} = {}) {
    if (!win || !recoveryAllowed(storage, now)) return false;
    const state = readState(storage);
    // Se anota ANTES de recargar: si la recarga vuelve a fallar, la próxima
    // llamada ya cuenta este intento y no entra en bucle.
    writeState(storage, { count: state.count + 1, at: now });
    await dropStaleShell(win);
    await reload();
    return true;
}

/**
 * Escucha los fallos de trozos y recupera la app.
 *
 * Se llama una vez, al arrancar (ver `index.js`), para que cubra también las
 * pantallas que se cargan bajo demanda mucho después. Devuelve cómo desinstalarlo.
 */
export function installChunkRecovery(win = typeof window === 'undefined' ? null : window) {
    if (!win?.addEventListener) return () => {};
    const onFailure = (event) => {
        const value = event?.reason || event?.error || event?.message || event;
        if (!isChunkLoadFailure(value)) return;
        void takeTheNewBuild({ win, storage: win.sessionStorage });
    };
    // Un `import()` que falla llega como promesa rechazada; un script que no carga,
    // como evento de error.
    win.addEventListener('unhandledrejection', onFailure);
    win.addEventListener('error', onFailure);
    return () => {
        win.removeEventListener('unhandledrejection', onFailure);
        win.removeEventListener('error', onFailure);
    };
}
