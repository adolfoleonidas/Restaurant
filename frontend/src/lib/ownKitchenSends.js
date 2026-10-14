/**
 * Los pedidos que ESTE dispositivo acaba de mandar a cocina.
 *
 * El aviso de cocina (`KitchenAlerts`) suena para cualquier pedido nuevo en la
 * cocina, y el mozo también lo recibe: al enviar, su propio teléfono le tapaba la
 * pantalla avisándole de lo que acababa de hacer, justo cuando iba a otra mesa.
 *
 * Un pase que mandaste tú no es una novedad para ti: lo que necesitas es ver que
 * OTRO pidió algo. En memoria basta: si la página se recarga, el pedido ya quedó en
 * la lista de "vistos" del aviso, así que tampoco vuelve a sonar.
 */
const sent = new Set();

/** Anota un envío propio para que no se avise a sí mismo. */
export function rememberOwnKitchenSend(orderId) {
    if (orderId) sent.add(orderId);
}

/** ¿Este pedido lo mandó este mismo dispositivo? */
export function isOwnKitchenSend(orderId) {
    return sent.has(orderId);
}

/** Solo para las pruebas. */
export function forgetOwnKitchenSends() {
    sent.clear();
}
