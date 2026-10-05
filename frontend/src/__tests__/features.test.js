import {
    FEATURE_DEFS,
    DEFAULT_FEATURES,
    mergeFeatures,
    subscribeFeatures,
    notifyFeaturesChanged,
} from '@/lib/features';

describe('feature registry', () => {
    it('defines a label and an off-by-default flag for every feature', () => {
        expect(FEATURE_DEFS.length).toBeGreaterThan(0);
        for (const def of FEATURE_DEFS) {
            expect(def.key).toBeTruthy();
            expect(def.label).toBeTruthy();
            expect(def.description).toBeTruthy();
            expect(DEFAULT_FEATURES[def.key]).toBe(false);
        }
    });

    it('normalizes partial or invalid API payloads into a full flag map', () => {
        expect(mergeFeatures(undefined)).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures(null)).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures('nope')).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures([1, 2])).toEqual(DEFAULT_FEATURES);
        expect(mergeFeatures({ voice_assistant: true })).toEqual({
            ...DEFAULT_FEATURES,
            voice_assistant: true,
        });
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
