/** What the waiter reads when the order outbox cannot reach the server (see `lineSyncQueue`). */

/** The connection failed: nothing is lost, the outbox keeps trying. */
export const STALLED_MESSAGE = 'Sin conexión. Tus productos quedan en este equipo y se guardan solos al volver la señal.';

/** An action that needs the taps saved first could not save them. */
export const UNSAVED_MESSAGE = 'Hay productos sin guardar. Revisa tu conexión e inténtalo de nuevo.';
