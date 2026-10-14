import { get, post, put, withParams } from './request';

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
