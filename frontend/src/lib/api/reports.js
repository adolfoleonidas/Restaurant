import { get, withParams } from './request';

export const getSalesReport = (params) => get('/reports/sales', { params });
export const getProductsReport = (params) => get('/reports/products', { params });
export const getTodayReport = (params) => get('/reports/today', withParams(params));
