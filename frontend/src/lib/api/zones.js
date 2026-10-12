import { get, post, patch, del } from './request';

export const listZones = () => get('/zones');
export const createZone = (payload) => post('/zones', payload);
export const updateZone = (id, payload) => patch(`/zones/${id}`, payload);
export const deleteZone = (id) => del(`/zones/${id}`);
