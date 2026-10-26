import {
    DEFAULT_REQUIRE_PAYMENT_TO_CLOSE,
    applyRestaurantPolicy,
    readRequirePayment,
    requirePaymentFromRestaurant,
    subscribeServicePolicy,
} from '@/lib/servicePolicy';

describe('venue payment-control policy', () => {
    afterEach(() => {
        // Deja el módulo como lo encuentra cualquier otra suite.
        applyRestaurantPolicy({ require_payment_to_close: DEFAULT_REQUIRE_PAYMENT_TO_CLOSE });
    });

    it('solo un false explícito apaga el control de pagos', () => {
        expect(DEFAULT_REQUIRE_PAYMENT_TO_CLOSE).toBe(true);
        expect(requirePaymentFromRestaurant(undefined)).toBe(true);
        expect(requirePaymentFromRestaurant({})).toBe(true);
        expect(requirePaymentFromRestaurant({ require_payment_to_close: null })).toBe(true);
        expect(requirePaymentFromRestaurant({ require_payment_to_close: true })).toBe(true);
        expect(requirePaymentFromRestaurant({ require_payment_to_close: false })).toBe(false);
    });

    it('actualiza el valor compartido y avisa a las pantallas abiertas', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeServicePolicy(listener);

        applyRestaurantPolicy({ require_payment_to_close: false });
        expect(readRequirePayment()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);

        // El mismo valor no vuelve a notificar.
        applyRestaurantPolicy({ require_payment_to_close: false });
        expect(listener).toHaveBeenCalledTimes(1);

        applyRestaurantPolicy({ require_payment_to_close: true });
        expect(readRequirePayment()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        applyRestaurantPolicy({ require_payment_to_close: false });
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
