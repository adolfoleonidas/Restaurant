import { get, post, patch, del } from './request';

export const listProducts = () => get('/products');
export const importProducts = (body) => post('/products/import', body);
export const createProduct = (payload) => post('/products', payload);
export const updateProduct = (id, payload) => patch(`/products/${id}`, payload);
export const deleteProduct = (id) => del(`/products/${id}`);
export const setProductAvailability = (id, body) => post(`/products/${id}/availability`, body);
