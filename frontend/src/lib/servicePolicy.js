/**
 * Cómo trata el local el dinero en la mesa. Es un ajuste del restaurante y lo
 * leen el piso y la hoja de la mesa. `useRestaurantFeatures` lo refresca cuando
 * Ajustes guarda (misma señal `notifyFeaturesChanged`), así que las pantallas
 * abiertas no necesitan recargar.
 *
 * Encendido (por defecto) = el comportamiento de siempre: la mesa solo se
 * finaliza cuando la cuenta está liquidada. Apagado = modo «solo pedidos»:
 * liberar la mesa no valida pago ni comida.
 */

export const DEFAULT_REQUIRE_PAYMENT_TO_CLOSE = true;

/** Only an explicit `false` turns payment control off; legacy rows stay on. */
export function requirePaymentFromRestaurant(restaurant) {
    return restaurant?.require_payment_to_close !== false;
}

let current = DEFAULT_REQUIRE_PAYMENT_TO_CLOSE;
const listeners = new Set();

export function readRequirePayment() {
    return current;
}

/** Applies a restaurant payload and notifies only when the value really changed. */
export function applyRestaurantPolicy(restaurant) {
    const next = requirePaymentFromRestaurant(restaurant);
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) {
        try { listener(); } catch { /* ignore */ }
    }
}

export function subscribeServicePolicy(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
