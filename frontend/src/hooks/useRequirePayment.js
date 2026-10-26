import { useEffect, useState } from 'react';
import { readRequirePayment, subscribeServicePolicy } from '@/lib/servicePolicy';

/**
 * The venue's current payment-control setting.
 *
 * The value is kept in `lib/servicePolicy`, refreshed by `useRestaurantFeatures`
 * (the screen that already reads `/restaurants/current`). Mounting this hook on
 * its own does not fetch: it subscribes, so every floor screen sees the same
 * value and Ajustes updates them without a reload.
 */
export default function useRequirePayment() {
    const [requirePayment, setRequirePayment] = useState(readRequirePayment);
    useEffect(() => subscribeServicePolicy(
        () => setRequirePayment(readRequirePayment()),
    ), []);
    return requirePayment;
}
