import { get, post, patch } from './request';

// La configuración del local la piden a la vez varias pantallas al abrir el Salón
// (AppShell, ThemeContext, `useRestaurantFeatures` y `useRestaurantName`). Se
// comparte la petición que ya está en vuelo (ver `get`, en este mismo archivo).
export const getRestaurant = () => get('/restaurants/current');
export const updateRestaurant = (payload) => patch('/restaurants/current', payload);
export const getSystemInfo = () => get('/system/info');
export const resetData = (body) => post('/data/reset', body);
export const resetCatalog = (body) => post('/data/catalog', body);
