import { get, post, patch } from './request';

export const createPayment = (payload) => post('/payments', payload);
export const uploadPaymentProof = (orderId, body) => post(`/payments/${orderId}/proof`, body);
export const voidPayment = (id, body) => post(`/payments/${id}/void`, body);
export const listPayments = (params) => get('/payments', { params });
export const listPaymentsByOrder = (orderId, config) => get(`/payments/by-order/${orderId}`, config);
export const listPaymentProofs = (params) => get('/payments/proofs', { params });

export const getPaymentConfig = () => get('/payment-config');
export const getCollectionConfig = () => get('/payment-config/collection');
export const updatePaymentConfig = (config) => patch('/payment-config', config);

export const listPendingPrepay = () => get('/public-prepay/pending');
export const runPrepayAction = (orderId, action) => post(`/public-prepay/${orderId}/${action}`);

export const createApproval = (body) => post('/approvals', body);
export const decideApproval = (id, body) => post(`/approvals/${id}/decide`, body);
