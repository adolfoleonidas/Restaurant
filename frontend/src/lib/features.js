/**
 * Optional feature registry. The venue switches modules on/off from Ajustes
 * (persisted per restaurant); the UI gates on these flags so a disabled module
 * renders nothing and runs no work.
 *
 * Kept framework-free: a tiny subscribe/notify pair lets the assistant refresh
 * immediately after Ajustes saves, without polling.
 */

export const FEATURE_DEFS = [
    {
        key: 'voice_assistant',
        label: 'Asistente de voz',
        description: 'Anuncia en voz los pedidos nuevos, los listos y las cuentas solicitadas.',
    },
    {
        key: 'proof_ocr',
        label: 'Lectura de comprobantes con IA',
        description: 'Lee las capturas de Yape/Plin y sugiere el monto. La IA propone, el humano confirma.',
    },
    {
        key: 'voice_commands',
        label: 'Comandos por voz',
        description: 'Permite avanzar y finalizar pedidos hablando, siempre con confirmación.',
    },
    {
        key: 'voice_queries',
        label: 'Consultas al asistente',
        description: 'Responde preguntas como "¿qué pedidos faltan?" usando datos que ya podés ver.',
    },
];

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
