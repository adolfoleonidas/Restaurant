import { useEffect, useState } from 'react';
import { getRestaurant } from '@/lib/api/restaurant';

/**
 * Restaurant name from settings ('' until it loads or if it cannot be read).
 * Only fetched while `enabled`, so a closed dialog costs no request.
 */
export default function useRestaurantName(enabled = true) {
    const [name, setName] = useState('');
    useEffect(() => {
        if (!enabled) return undefined;
        let active = true;
        Promise.resolve()
            .then(() => getRestaurant())
            .then((response) => { if (active) setName(response?.data?.name || ''); })
            .catch(() => { /* the receipt just prints without a name */ });
        return () => { active = false; };
    }, [enabled]);
    return name;
}
