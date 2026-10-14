import {
    FEATURE_DEFS,
    DEFAULT_FEATURES,
    mergeFeatures,
    subscribeFeatures,
    notifyFeaturesChanged,
} from '@/lib/features';

describe('feature registry', () => {
    it('hoy no ofrece ninguna funcion, y las que se declaren traen todo', () => {
        // La longitud se afirma aparte para que este test no sea vacio mientras el
        // registro esté a proposito vacío; el bucle sigue exigiendo la forma el día
        // que se vuelva a ofrecer alguna.
        expect(FEATURE_DEFS).toHaveLength(0);
        for (const def of FEATURE_DEFS) {
            expect(def.key).toBeTruthy();
            expect(def.label).toBeTruthy();
            expect(def.description).toBeTruthy();
            expect(DEFAULT_FEATURES[def.key]).toBe(false);
        }
    });

    it('un flag que el registro no conoce no enciende nada', () => {
        // Esto es lo que hace segura la retirada: `mergeFeatures` solo copia claves
        // declaradas, así que un `true` que se hubiera quedado en la base (o que
        // mandara un cliente viejo) no puede volver a encender una función.
        expect(DEFAULT_FEATURES).toEqual({});
        expect(mergeFeatures({ voice_assistant: true, item_void: true })).toEqual({});
    });

    it('normalizes partial or invalid API payloads into a full flag map', () => {
        expect(mergeFeatures(undefined)).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures(null)).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures('nope')).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures([1, 2])).toEqual(DEFAULT_FEATURES);
        // Non-boolean values are ignored rather than trusted.
        expect(mergeFeatures({ voice_assistant: 'yes' })).toEqual(DEFAULT_FEATURES);
    });

    it('notifies subscribers and unsubscribes cleanly', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeFeatures(listener);
        notifyFeaturesChanged();
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        notifyFeaturesChanged();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
