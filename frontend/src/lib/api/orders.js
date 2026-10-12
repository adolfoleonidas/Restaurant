import { get, post, patch, del } from './request';

export const getOrder = (id, config) => get(`/orders/${id}`, config);
export const listOrders = (params) => get('/orders', { params });
export const getKitchenOrders = () => get('/orders/kitchen');
export const createOrder = (payload) => post('/orders', payload);

export const addOrderItems = (id, items) => post(`/orders/${id}/items`, items);
export const updateOrderItem = (id, itemId, body) => patch(`/orders/${id}/items/${itemId}`, body);
export const removeOrderItem = (id, itemId) => del(`/orders/${id}/items/${itemId}`);
export const voidOrderItem = (id, itemId, body) => post(`/orders/${id}/items/${itemId}/void`, body);
export const setOrderItemStatus = (id, itemId, body) => post(`/orders/${id}/items/${itemId}/status`, body);
export const moveOrderItem = (id, itemId, body) => post(`/orders/${id}/items/${itemId}/move`, body);

export const sendOrderToKitchen = (id) => post(`/orders/${id}/send-to-kitchen`);
export const bumpOrder = (id, body) => post(`/orders/${id}/bump`, body);
export const mergeOrder = (id, body) => post(`/orders/${id}/merge`, body);
export const moveOrder = (id, body) => post(`/orders/${id}/move`, body);
export const splitOrder = (id, body) => post(`/orders/${id}/split`, body);
export const setOrderAlias = (id, body) => patch(`/orders/${id}/alias`, body);
export const setOrderNotes = (id, body) => patch(`/orders/${id}/notes`, body);
export const serveOrder = (id) => post(`/orders/${id}/serve`);
export const closeOrderAttention = (id) => post(`/orders/${id}/attention/close`);
export const setOrderStatus = (id, body) => post(`/orders/${id}/status`, body);
export const reassignOrder = (id, body) => post(`/orders/${id}/reassign`, body);
export const confirmOrderPayment = (id) => post(`/orders/${id}/confirm-payment`);
