import { get, post, patch } from './request';

/**
 * La configuración del local, con la petición compartida.
 *
 * `/restaurants/current` la piden a la vez varias pantallas al abrir el Salón
 * (AppShell, ThemeContext, `useRestaurantFeatures` y `useRestaurantName`). En el
 * teléfono del mozo eso eran tres o cuatro peticiones IDÉNTICAS de 1 KB en
 * paralelo, pisándose en el enlace: medido en el dispositivo, 400-670 ms cada una
 * para un solo KB, mientras `/api/tables` devolvía 4-6 KB en 157 ms.
 *
 * Se comparte la que está en vuelo: la primera llama, las demás esperan la misma
 * respuesta. No se guarda después: cuando termina, la próxima petición vuelve a
 * pedirla, así que una pantalla que se abre más tarde no lee datos viejos.
 */
let inFlight = null;

export function getRestaurant() {
    if (inFlight) return inFlight;
    // Síncrono a propósito: si el api está degradado y `get` lanza de inmediato,
    // el que llama lo ve (ya lo protegía `useRestaurantFeatures`), y no se queda
    // una promesa colgada compartida por todos.
    const request = get('/restaurants/current');
    const shared = Promise.resolve(request).finally(() => {
        if (inFlight === shared) inFlight = null;
    });
    inFlight = shared;
    return shared;
}

export const updateRestaurant = (payload) => patch('/restaurants/current', payload);
export const getSystemInfo = () => get('/system/info');
export const resetData = (body) => post('/data/reset', body);
export const resetCatalog = (body) => post('/data/catalog', body);
