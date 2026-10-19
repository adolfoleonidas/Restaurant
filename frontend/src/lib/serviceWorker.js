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
// Rutas públicas (carta, checkout, seguimiento): ahí el que usa la app es un
// cliente, que puede estar armando su pedido o subiendo un comprobante, y una
// recarga de golpe le tira lo que hace. No se recarga: se muestra un aviso
// pequeño "Nueva versión disponible — Actualizar" que no bloquea nada y recarga
// cuando el cliente toca el botón. Mientras tanto la pestaña sigue con la build
// vieja; si pide un trozo que ya no existe, `lib/chunkRecovery` recarga solo
// entonces. Las pantallas del personal conservan la recarga inmediata.
//
// Búsqueda activa: el navegador solo busca un service worker nuevo al navegar o
// cada 24 h, y el celular del mozo deja la app abierta todo el turno sin
// recargar. Por eso se pide `registration.update()` al volver a primer plano y
// cada 15 minutos con la app visible; si hay build nueva, el `controllerchange`
// de arriba hace el resto.
import { reloadWithPendingTaps } from '@/lib/reloadWithPendingTaps';
import { isPublicPath } from '@/lib/authSession';

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

// Aviso no modal de versión nueva. DOM puro (no React): vive fuera del árbol de la
// app y no depende de ningún proveedor ni de los estilos de la pantalla.
function showUpdatePrompt(onUpdate) {
    if (document.querySelector('[data-testid="sw-update-banner"]')) return;
    const banner = document.createElement('div');
    banner.setAttribute('data-testid', 'sw-update-banner');
    banner.setAttribute('role', 'status');
    Object.assign(banner.style, {
        position: 'fixed', left: '12px', right: '12px', bottom: '12px', zIndex: '2147483647',
        display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: '10px', background: '#10201a', color: '#fff',
        font: '14px system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)',
    });
    const text = document.createElement('span');
    text.textContent = 'Nueva versión disponible';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Actualizar';
    Object.assign(button.style, {
        padding: '6px 12px', borderRadius: '8px', border: '0', background: '#fff',
        color: '#10201a', font: 'inherit', fontWeight: '600', cursor: 'pointer',
    });
    button.addEventListener('click', onUpdate);
    banner.append(text, button);
    document.body.appendChild(banner);
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
        if (isPublicPath(window.location.pathname)) {
            // El cliente decide cuándo: ver el comentario de arriba.
            showUpdatePrompt(() => {
                if (reloading) return;
                reloading = true;
                void reloadWithPendingTaps(window);
            });
            return;
        }
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
