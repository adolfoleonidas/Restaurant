// Registro del service worker.
//
// Solo en producción: en desarrollo react-scripts no genera el archivo y un
// service worker antiguo serviría una versión en caché de la app, que es la
// forma más rápida de depurar un fantasma.
//
// Auto-update: el service worker compila con `skipWaiting()` + `clientsClaim()`
// (ver `src/service-worker.js`), así que una versión nueva toma el control con
// la pestaña abierta en lugar de esperar a que se cierren TODAS (podía tardar
// días). Cuando eso pasa, esta pestaña recarga UNA sola vez: los trozos de
// código ya cargados (las pantallas del POS se cargan bajo demanda) seguirían
// siendo los viejos y una ruta nueva pediría un archivo que ya no existe en la
// caché, así que el paso a la build nueva tiene que ser completo.
//
// Unsaved taps: the waiter's taps reach the server in batches (see
// `lib/lineSyncQueue`), so a batch may be waiting when the page reloads. It gets a
// moment to arrive first; if the connection does not answer, the reload goes ahead
// anyway: what is pending is kept on the device and sent when that order is opened.
//
// Búsqueda activa: el navegador solo busca un service worker nuevo al navegar o
// cada 24 h, y el celular del mozo deja la app abierta todo el turno sin
// recargar. Por eso se pide `registration.update()` al volver a primer plano y
// cada 15 minutos con la app visible; si hay build nueva, el `controllerchange`
// de arriba hace el resto.
import { reloadWithPendingTaps } from '@/lib/reloadWithPendingTaps';

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const watched = new WeakSet();

function watchForUpdates(registration) {
    if (!registration || typeof registration.update !== 'function') return;
    // Un mismo registro se vigila una sola vez, aunque `register` resuelva varias veces.
    if (watched.has(registration)) return;
    watched.add(registration);
    const check = () => {
        if (document.visibilityState !== 'visible') return;
        // Sin red no hay nada que buscar: la próxima vuelta lo reintenta.
        Promise.resolve(registration.update()).catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

export function registerServiceWorker() {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // La recarga solo aplica a una ACTUALIZACIÓN: si la página arrancó sin
    // service worker (primera visita), el primer `controllerchange` viene del
    // propio registro y no hay nada viejo que reemplazar.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener?.('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        void reloadWithPendingTaps(window);
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(`${process.env.PUBLIC_URL}/service-worker.js`, {
                // Sin caché HTTP al buscar actualizaciones: nginx ya sirve el
                // archivo sin caché, pero esto cubre también proxies intermedios.
                updateViaCache: 'none',
            })
            .then(watchForUpdates)
            .catch(() => {
                // Sin service worker la app funciona igual: solo pierde la
                // caché y la instalación como aplicación.
            });
    });
}
