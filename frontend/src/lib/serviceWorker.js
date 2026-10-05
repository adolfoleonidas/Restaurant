// Registro del service worker.
//
// Solo en producción: en desarrollo react-scripts no genera el archivo y un
// service worker antiguo serviría una versión en caché de la app, que es la
// forma más rápida de depurar un fantasma.
//
// No se fuerza `skipWaiting`: si una versión nueva tomara el control con la
// pestaña abierta, los trozos de código que aún no se han descargado (las
// pantallas del POS se cargan bajo demanda) podrían pedirse con un nombre que
// ya no existe en la caché nueva y la navegación fallaría. Con el
// comportamiento por defecto, la versión nueva activa al cerrar la app y
// mientras tanto la pestaña sigue servida por la caché con la que empezó.
export function registerServiceWorker() {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(`${process.env.PUBLIC_URL}/service-worker.js`)
            .catch(() => {
                // Sin service worker la app funciona igual: solo pierde la
                // caché y la instalación como aplicación.
            });
    });
}
