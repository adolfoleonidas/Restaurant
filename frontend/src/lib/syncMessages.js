/** What the waiter reads when the order outbox cannot reach the server (see `lineSyncQueue`). */

/** The connection failed: nothing is lost, the outbox keeps trying. */
export const STALLED_MESSAGE = 'Sin conexión. Tus productos quedan en este equipo y se guardan solos al volver la señal.';

/** An action that needs the taps saved first could not save them. */
export const UNSAVED_MESSAGE = 'Hay productos sin guardar. Revisa tu conexión e inténtalo de nuevo.';

/**
 * Los toques no tenían dónde entrar: la cuenta que estaban abriendo ya no es la que
 * está en pantalla (el mozo cambió de mesa o de cuenta mientras se creaba).
 *
 * Se dicen en voz alta porque antes se borraban sin avisar, y eso se vive como
 * "toqué y no agarró": el mozo vuelve a tocar sin saber si el problema fue suyo.
 */
export const DROPPED_MESSAGE = 'No se pudieron guardar esos productos: la cuenta cambió de pantalla. Vuelve a tocarlos.';
