/* eslint-disable no-restricted-globals */

// Service worker de la PWA.
//
// react-scripts detecta este archivo (`src/service-worker.js`) y compila con
// Workbox en modo InjectManifest, así que `self.__WB_MANIFEST` llega relleno
// con todos los archivos versionados del build: la app queda disponible sin
// conexión sin añadir dependencias ni tocar `craco.config.js`.
//
// Lo que NO se cachea: ningún endpoint que mueva dinero. Caja, pedidos y cobros
// siempre se piden al servidor; como mucho se sirve la carta pública desde
// caché durante 5 minutos, y aun así con revalidación en segundo plano.

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

// Toma el control de las pestañas ya abiertas en cuanto activa, sin esperar a
// que se cierren todas (si no, una actualización puede tardar días en applied).
clientsClaim();

// Si el manifiesto llegara vacío, el service worker sigue siendo útil: las
// reglas de ejecución de abajo no dependen de él.
const precacheManifest = self.__WB_MANIFEST || [];
precacheAndRoute(precacheManifest);

// Navegación: la app es una SPA. Cualquier ruta se resuelve con el `index.html`
// cacheado, así abrir un enlace directo sin conexión muestra la app (y su aviso
// de sin conexión) en lugar del error del navegador.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${process.env.PUBLIC_URL}/index.html`), {
    denylist: [/^\/api\//],
  }),
);

// Carta pública: es la pantalla que el cliente abre de pie, dentro del local y
// muchas veces con mala señal. Se intenta la red primero (3 s) y si no hay, se
// sirve la copia cacheada; los precios caducan a los 5 minutos para que una
// carta vieja no sobreviva a un cambio de precio. El evento SSE del seguimiento
// queda fuera a propósito: un stream nunca debe salir de caché.
registerRoute(
  ({ request, url }) =>
    request.method === 'GET'
    && url.pathname.startsWith('/api/public/')
    && !url.pathname.startsWith('/api/public/stream'),
  new NetworkFirst({
    cacheName: 'carta-publica',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 300 })],
  }),
);

// Fuentes: sin ellas la app se ve con la tipografía del sistema, pero son una
// petición externa que en móvil se nota.
registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({ cacheName: 'fuentes' }),
);

// Fotos de platos: lo que más pesa en datos móviles y lo que menos cambia.
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'imagenes',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 604800 })],
  }),
);
