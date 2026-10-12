import { get, post, patch, del } from './request';

export const getPublicRestaurant = () => get('/public/restaurant');
export const getPublicCategories = () => get('/public/categories');
export const getPublicProducts = () => get('/public/products');
export const getPublicTables = () => get('/public/tables');
export const getPublicPaymentConfig = () => get('/public/payment-config');
export const resolvePublicTable = (token) => get('/public/tables/resolve', { params: { token } });
export const getPublicTableSession = (token) => get('/public/tables/session', { params: { token } });
export const listPickupBranches = () => get('/public/pickup-branches');
export const listDeliveryBranches = () => get('/public/delivery-branches');

export const getPublicOrder = (code) => get(`/public/orders/${code}`);
export const getPublicOrderTable = (code) => get(`/public/orders/${code}/table`);
export const createPublicOrder = (payload) => post('/public/orders', payload);
export const uploadPublicOrderProof = (code, body, config) => post(`/public/orders/${code}/proof`, body, config);
export const addPublicOrderItem = (code, body) => post(`/public/orders/${code}/items`, body);
export const updatePublicOrderItem = (code, lineId, body) => patch(`/public/orders/${code}/items/${lineId}`, body);
export const removePublicOrderItem = (code, lineId) => del(`/public/orders/${code}/items/${lineId}`);
