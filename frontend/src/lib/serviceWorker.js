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
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(`${process.env.PUBLIC_URL}/service-worker.js`, {
                // Sin caché HTTP al buscar actualizaciones: nginx ya sirve el
                // archivo sin caché, pero esto cubre también proxies intermedios.
                updateViaCache: 'none',
            })
            .catch(() => {
                // Sin service worker la app funciona igual: solo pierde la
                // caché y la instalación como aplicación.
            });
    });
}
