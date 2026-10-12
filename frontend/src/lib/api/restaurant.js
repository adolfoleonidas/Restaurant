import { get, post, patch } from './request';

export const getRestaurant = () => get('/restaurants/current');
export const updateRestaurant = (payload) => patch('/restaurants/current', payload);
export const getSystemInfo = () => get('/system/info');
export const resetData = (body) => post('/data/reset', body);
export const resetCatalog = (body) => post('/data/catalog', body);
