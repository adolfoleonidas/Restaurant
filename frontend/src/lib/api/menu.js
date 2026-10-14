import { del, get, post, put, withParams } from './request';

/**
 * Menú del día (ver `backend/routes/menu.py`).
 *
 * El contrato que fija este módulo es el de las URLs: `MenuApi.test.js` las
 * comprueba para que un renombrado en el backend no rompa la pantalla en
 * silencio.
 */

/** El día (borrador o publicado) y el catálogo con su estado efectivo de hoy. */
export const getMenuDay = (date) => get('/menu/day', withParams(date ? { date } : undefined));

/** Guarda el día. Sin `publish` queda en borrador y no cambia la carta. */
export const saveMenuDay = (payload) => put('/menu/day', payload);

/** Agotar es inmediato: no pasa por publicar nada. */
export const setMenuSoldOut = (payload) => post('/menu/day/sold-out', payload);

/** Trae los platos de otro día; no arrastra estado ni precio. */
export const copyMenuFrom = (payload) => post('/menu/day/copy-from', payload);

/**
 * Plantillas: una selección con nombre para no volver a montar el mismo menú.
 * Guardan los platos, no los precios.
 */
export const listMenuTemplates = () => get('/menu/templates');
export const saveMenuTemplate = (payload) => post('/menu/templates', payload);
export const deleteMenuTemplate = (id) => del(`/menu/templates/${id}`);
/** Aplica la plantilla a un día; el día queda en borrador, no publicado. */
export const applyMenuTemplate = (id, payload) => post(`/menu/templates/${id}/apply`, payload);
/** Repite en días concretos. Es explícito: hay que decir qué días. */
export const repeatMenuTemplate = (id, payload) => post(`/menu/templates/${id}/repeat`, payload);
