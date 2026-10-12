import { get, post, patch, del } from './request';

export const listCategories = () => get('/categories');
export const createCategory = (payload) => post('/categories', payload);
export const updateCategory = (id, payload) => patch(`/categories/${id}`, payload);
export const deleteCategory = (id) => del(`/categories/${id}`);
