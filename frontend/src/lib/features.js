/**
 * Optional feature registry. The venue switches modules on/off from Ajustes
 * (persisted per restaurant); the UI gates on these flags so a disabled module
 * renders nothing and runs no work.
 *
 * HOY NO SE OFRECE NINGUNA. Las cinco que había —asistente de voz, lectura de
 * comprobantes con IA, comandos por voz, consultas al asistente y anular
 * productos sueltos— quedaron fuera de la oferta.
 *
 * El registro vacío hace más que esconder la tarjeta de Ajustes: `mergeFeatures`
 * solo copia las claves que existan aquí, así que un `true` que se hubiera
 * quedado en la base **no enciende nada**. Retirar la entrada es la forma
 * segura de retirar la función; dejarla con la bandera en `false` no lo sería,
 * porque cualquier fila con `true` volvería a encenderla.
 *
 * Para volver a ofrecer una: devolverle su entrada aquí (las cinco están en el
 * historial de este fichero) y su bandera volverá a leerse de la API. El test
 * `features.test.js` exige que cada entrada traiga `key`, `label`, `description`
 * y una bandera apagada por defecto.
 *
 * Kept framework-free: a tiny subscribe/notify pair lets the assistant refresh
 * immediately after Ajustes saves, without polling.
 */

export const FEATURE_DEFS = [];

export const DEFAULT_FEATURES = FEATURE_DEFS.reduce(
    (acc, def) => ({ ...acc, [def.key]: false }),
    {},
);

/** Normalizes whatever the API returns into a full flag map. */
export function mergeFeatures(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const merged = { ...DEFAULT_FEATURES };
    for (const key of Object.keys(DEFAULT_FEATURES)) {
        if (typeof source[key] === 'boolean') merged[key] = source[key];
    }
    return merged;
}

const listeners = new Set();

/** Announces that the restaurant features changed (after a successful save). */
export function notifyFeaturesChanged() {
    for (const listener of [...listeners]) {
        try { listener(); } catch { /* ignore */ }
    }
}

export function subscribeFeatures(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
