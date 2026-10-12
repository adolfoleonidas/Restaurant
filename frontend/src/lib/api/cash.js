import { get, post } from './request';

export const getCash = () => get('/cash');
export const getCurrentCash = (config) => get('/cash/current', config);
export const openCash = (body) => post('/cash/open', body);
export const closeCash = (body) => post('/cash/close', body);
export const addCashMovement = (body) => post('/cash/movements', body);
export const listCashHistory = (params) => get('/cash/history', { params });
