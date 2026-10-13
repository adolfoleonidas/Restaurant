import { flushAllOutboxes, hasPendingOutbox } from '@/lib/outboxRegistry';

/** Cuánto se espera a que los toques pendientes lleguen antes de recargar. */
export const RELOAD_FLUSH_TIMEOUT_MS = 1500;

/**
 * Recarga la página sin perder lo que el mozo ya tocó.
 *
 * Los toques viajan en lotes (ver `lib/lineSyncQueue`), así que justo cuando la
 * página se recarga puede haber un lote esperando. Se le da un momento para
 * llegar; si la conexión no responde, la recarga sigue igual: lo pendiente queda
 * guardado en el dispositivo y se manda al abrir esa cuenta otra vez.
 */
export function reloadWithPendingTaps(win = window, { timeoutMs = RELOAD_FLUSH_TIMEOUT_MS } = {}) {
    const reload = () => win.location.reload();
    if (!hasPendingOutbox()) {
        reload();
        return Promise.resolve();
    }
    return flushAllOutboxes({ timeoutMs }).catch(() => {}).then(reload);
}

export default reloadWithPendingTaps;
