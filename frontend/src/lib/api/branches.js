import { get, post, patch } from './request';

export const listBranches = () => get('/branches');
export const createBranch = (payload) => post('/branches', payload);
export const updateBranch = (id, payload) => patch(`/branches/${id}`, payload);
