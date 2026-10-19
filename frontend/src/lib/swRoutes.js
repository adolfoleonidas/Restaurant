// Reglas de enrutado del service worker (`src/service-worker.js`).
//
// Viven aparte, sin dependencias de Workbox, para poder probarlas con Jest: el
// service worker en sí solo corre dentro del navegador.

// Lo público que NUNCA se guarda: el seguimiento del pedido y la sesión de mesa
// cambian con cada tick de cocina y llevan datos del cliente. Con la caché de 5
// minutos de la carta, el cliente vería "En preparación" cuando ya está listo, y
// el pedido quedaría guardado en Cache Storage del teléfono. Van siempre a la red.
const NEVER_CACHED_PUBLIC = [
    '/api/public/stream', // un stream SSE nunca debe salir de caché
    '/api/public/orders/',
    '/api/public/tables/session',
];

/** ¿Se puede servir esta petición pública desde la caché de la carta? */
export function shouldCachePublicApi({ request, url }) {
    return request.method === 'GET'
        && url.pathname.startsWith('/api/public/')
        && !NEVER_CACHED_PUBLIC.some((prefix) => url.pathname.startsWith(prefix));
}

// Navegaciones que NO se resuelven con el `index.html` de la SPA: la API y la
// página de rescate (`reset-sw.html`), que justamente existe para cuando el
// service worker sirve una app rota.
export const NAVIGATION_DENYLIST = [/^\/api\//, /^\/reset-sw\.html/];
