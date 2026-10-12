import { useEffect, useState } from 'react';
import { getRestaurant } from '@/lib/api/restaurant';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_FEATURES, mergeFeatures, subscribeFeatures } from '@/lib/features';

/**
 * Reads the venue's enabled modules and keeps them fresh: Ajustes calls
 * `notifyFeaturesChanged()` after a successful save, so no polling is needed.
 */
export default function useRestaurantFeatures() {
    const { user } = useAuth();
    const [features, setFeatures] = useState(DEFAULT_FEATURES);

    useEffect(() => {
        if (!user) {
            setFeatures(DEFAULT_FEATURES);
            return undefined;
        }
        let active = true;
        const load = () => getRestaurant()
            .then(({ data }) => { if (active) setFeatures(mergeFeatures(data?.features)); })
            .catch(() => { /* keep the current flags */ });
        load();
        const unsubscribe = subscribeFeatures(load);
        return () => { active = false; unsubscribe(); };
    }, [user]);

    return features;
}
