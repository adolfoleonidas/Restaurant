import { get, post, patch, del } from './request';

export const listUsers = () => get('/users');
export const createUser = (payload) => post('/users', payload);
export const updateUser = (id, payload) => patch(`/users/${id}`, payload);
export const deleteUser = (id) => del(`/users/${id}`);
