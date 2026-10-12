/**
 * Payment methods as the cashier sees them (prototype ids) and as the backend
 * stores them. One place for the mapping, shared by the charge dialog and the
 * cash screen.
 */
export const PAYMENT_METHODS = [
    { id: 'cash', name: 'Efectivo', backend: 'efectivo' },
    { id: 'yape', name: 'Yape', backend: 'yape' },
    { id: 'plin', name: 'Plin', backend: 'plin' },
    { id: 'card', name: 'Tarjeta', backend: 'tarjeta' },
    { id: 'transfer', name: 'Transferencia', backend: 'transferencia' },
    { id: 'mixed', name: 'Mixto', backend: 'mixto' },
];

/** prototype id -> backend id */
export const METHOD_MAP = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m.backend]));

/** backend id -> prototype id */
export const METHOD_REV = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.backend, m.id]));

/** Backend ids of the methods that never go to the cash drawer. */
export const DIGITAL_METHODS = ['yape', 'plin', 'tarjeta', 'transferencia'];

/** Prototype ids of the wallet methods that can carry a payment proof. */
export const WALLET_METHOD_IDS = ['yape', 'plin'];

export const isWalletMethod = (id) => WALLET_METHOD_IDS.includes(id);

export const toBackendMethod = (id) => METHOD_MAP[id] || 'efectivo';
