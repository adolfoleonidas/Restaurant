import { get, post, patch, del, withParams } from './request';

export const listTables = (params) => get('/tables', withParams(params));
export const createTable = (payload) => post('/tables', payload);
export const updateTable = (id, payload) => patch(`/tables/${id}`, payload);
export const deleteTable = (id) => del(`/tables/${id}`);
export const releaseTable = (id) => post(`/tables/${id}/release`);
export const transferTable = (id, body) => post(`/tables/${id}/transfer`, body);

export const getTableGuestLink = (id) => get(`/tables/${id}/guest-link`);
export const rotateTableQr = (id) => post(`/tables/${id}/qr/rotate`);
export const revokeTableQr = (id) => post(`/tables/${id}/qr/revoke`);

export const createTableGroup = (body) => post('/table-groups', body);
export const deleteTableGroup = (id) => del(`/table-groups/${id}`);
// Un grupo ya unido admite mesas nuevas sin separarlo: el servidor revalida la
// unión completa y vuelve a elegir la mesa principal.
export const addTableGroupMember = (groupId, tableId) => post(`/table-groups/${groupId}/tables`, { table_id: tableId });
export const removeTableGroupMember = (groupId, tableId) => del(`/table-groups/${groupId}/tables/${tableId}`);
