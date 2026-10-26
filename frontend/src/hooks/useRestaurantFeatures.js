import { useEffect, useState } from 'react';
import { getRestaurant } from '@/lib/api/restaurant';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_FEATURES, mergeFeatures, subscribeFeatures } from '@/lib/features';
import { applyRestaurantPolicy } from '@/lib/servicePolicy';

/**
 * Reads the venue's settings and keeps them fresh: Ajustes calls
 * `notifyFeaturesChanged()` after a successful save, so no polling is needed.
 *
 * Trae dos cosas del mismo documento: los módulos (`features`) y la política de
 * cobro (`require_payment_to_close`), que se publica en `lib/servicePolicy` para
 * que el piso la lea sin otro GET.
 */
export default function useRestaurantFeatures() {
    const { user } = useAuth();
    const [features, setFeatures] = useState(DEFAULT_FEATURES);
    // Identidad estable: los contextos pueden recrear el objeto `user` en cada
    // render y el efecto no debe re-descargar por eso.
    const userId = user?.id;
    const restaurantId = user?.restaurant_id;

    useEffect(() => {
        if (!userId) {
            setFeatures(DEFAULT_FEATURES);
            return undefined;
        }
        let active = true;
        const load = () => {
            // Un mock o un api degradado pueden devolver algo que no es promesa:
            // sin flags simplemente se mantienen los defaults (todo apagado).
            let request;
            try { request = getRestaurant(); } catch { return; }
            if (!request || typeof request.then !== 'function') return;
            request
                .then(({ data }) => {
                    if (!active) return;
                    setFeatures(mergeFeatures(data?.features));
                    // Misma lectura: la política de cobro viaja en el mismo
                    // documento y alimenta `useRequirePayment` sin otro GET.
                    applyRestaurantPolicy(data);
                })
                .catch(() => { /* keep the current flags */ });
        };
        load();
        const unsubscribe = subscribeFeatures(load);
        return () => { active = false; unsubscribe(); };
    }, [userId, restaurantId]);

    return features;
}
