import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { saveDraftLines } from '@/lib/api/orders';
import { newClientId } from '@/lib/clientId';
import { buildDraftLine } from '@/lib/draftLines';
import { ORDER_SYNC_DELAY_MS, createLineSyncQueue } from '@/lib/lineSyncQueue';
import { overlayPendingLines, resolveLineChange, resolveTap } from '@/lib/optimisticOrder';

/** The server's per-line report travels with the order; the screens only want the order. */
const withoutReport = ({ line_results: ignored, ...order }) => order;

/** A line the server rejected, as the error `apiErrorMessage` knows how to read. */
const rejection = (result) => ({ response: { status: 400, data: { detail: result.detail } } });

/**
 * Optimistic quantities for an order composer, saved in batches.
 *
 * `order` is the last order the server confirmed. The hook returns that order
 * with the waiter's pending taps laid over it (`order`), plus `tap` and
 * `changeLine`, which only record what the waiter wants. Nothing is sent per tap:
 * the outbox (see `lib/lineSyncQueue`) saves everything pending in ONE request a
 * moment after the last tap, or at once on `flush()` (send, leave, switch
 * account), when the app goes to the background or the page is hidden, and when
 * the connection comes back. Nothing is disabled while it syncs, so a quick
 * "+ + +" can never lose a tap.
 *
 * The caller provides the pieces that depend on where the order lives:
 * - `ensureOrderId()`: id of the order, creating it on the first product. It is
 *   called as soon as the first product is tapped, not after the pause, so the
 *   table shows as occupied.
 * - `loadOrder(orderId)`: re-reads the order, applies it to the caller's state
 *   and returns it (null when it cannot be read). It must throw on network errors.
 * - `acceptOrder(order)` (optional): applies an order the server just returned
 *   to the caller's state. A batch answers with the whole order, so the lines are
 *   confirmed from that answer and `loadOrder` is only the fallback for a
 *   response that carries no usable order.
 * - `onError(error, entry)`: called once for each line the server rejected and
 *   once for a batch it refused; those taps have already been put back to the
 *   last confirmed quantity.
 * - `onStalled(error)`: the connection failed; the taps stay on screen and in the
 *   outbox and are sent again by themselves.
 * - `onSynced()`: called when the outbox empties.
 * - `placeholder`: the empty order shown before the first product exists.
 */
export default function useOrderLineSync({
    order, placeholder, ensureOrderId, loadOrder, acceptOrder, onError, onStalled, onSynced,
    delayMs = ORDER_SYNC_DELAY_MS,
}) {
    // What the outbox has not confirmed yet; a new object on every change, so the
    // screen re-renders whenever a tap is recorded or confirmed.
    const [entries, setEntries] = useState({});
    // The last order the server confirmed, as seen by the sync code. While a
    // request is on the wire it is refreshed by the outbox itself; otherwise by the render.
    const latest = useRef(order);
    const handlers = useRef({});
    handlers.current = {
        placeholder, ensureOrderId, loadOrder, acceptOrder, onError, onStalled, onSynced,
    };
    const queueRef = useRef(null);

    if (!queueRef.current) {
        // The order as the server has it after a write: taken from the write's own
        // response when it carries the order, otherwise read once more.
        const confirmed = async (orderId, response) => {
            const written = response?.data;
            const usable = written?.id === orderId && Array.isArray(written.items);
            if (usable && handlers.current.acceptOrder) {
                const saved = withoutReport(written);
                handlers.current.acceptOrder(saved);
                latest.current = saved;
                return saved;
            }
            const data = await handlers.current.loadOrder(orderId);
            if (data) latest.current = data;
            return data;
        };

        // One batch: what each pending entry asks of the server, in one request.
        const run = async ({ orderId, items }) => {
            const known = latest.current?.id === orderId ? latest.current.items || [] : [];
            const lines = [];
            const sent = [];
            items.forEach(({ key, entry }) => {
                const line = buildDraftLine(entry, known);
                if (!line) return;
                lines.push(line);
                sent.push({ key, clientLineId: line.client_line_id });
                // From here on the server may hold this quantity even if the answer never arrives.
                Object.assign(entry, { attempted: true });
            });
            // Every tap netted out to what the server already has: nothing to write.
            if (!lines.length) return {};

            const response = await saveDraftLines(orderId, lines);
            const reports = new Map((response?.data?.line_results || []).map((report) => [report.client_line_id, report]));
            await confirmed(orderId, response);
            const rejected = sent
                .filter(({ clientLineId }) => reports.get(clientLineId)?.result === 'rejected')
                .map(({ key, clientLineId }) => ({ key, error: rejection(reports.get(clientLineId)) }));
            return { rejected };
        };

        queueRef.current = createLineSyncQueue({
            run,
            resolveOrder: () => handlers.current.ensureOrderId(),
            delayMs,
            onChange: () => setEntries(queueRef.current.snapshot()),
            onError: (error, entry) => handlers.current.onError?.(error, entry),
            onStalled: (error) => handlers.current.onStalled?.(error),
            onDrain: () => handlers.current.onSynced?.(),
        });
    }
    const queue = queueRef.current;

    useLayoutEffect(() => {
        if (!queue.inFlight()) latest.current = order;
    }, [order, entries, queue]);

    // Closing the tab with taps still on their way would lose them.
    const syncing = queue.busy();
    useEffect(() => {
        if (!syncing) return undefined;
        const warn = (event) => {
            event.preventDefault();
            // eslint-disable-next-line no-param-reassign
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [syncing]);

    // The moments that cannot wait for the pause: the app goes to the background,
    // the page is hidden or closed, the connection comes back, the screen goes away.
    useEffect(() => {
        const saveNow = () => { if (queue.pending()) void queue.flush(); };
        const onVisibility = () => { if (document.visibilityState === 'hidden') saveNow(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', saveNow);
        window.addEventListener('online', saveNow);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', saveNow);
            window.removeEventListener('online', saveNow);
            saveNow();
        };
    }, [queue]);

    const optimisticOrder = useMemo(
        () => overlayPendingLines(order, entries, placeholder),
        [order, entries, placeholder]
    );

    const currentOptimistic = () => overlayPendingLines(latest.current, queue.snapshot(), handlers.current.placeholder);

    const tap = useCallback((product, direction) => {
        const hit = resolveTap(currentOptimistic(), product, direction);
        if (!hit) return Promise.resolve();
        // A product with no line yet gets, once, the id its line will have in the
        // batch. Later taps on it reuse that id, so a replayed batch never adds a second line.
        if (hit.patch.kind === 'new' && !queue.get(hit.key)?.clientLineId) {
            hit.patch.clientLineId = newClientId();
        }
        queue.set(hit.key, hit.patch);
        return Promise.resolve();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue]);

    const changeLine = useCallback((item, delta, orderId) => {
        const hit = resolveLineChange(item, delta, orderId);
        if (hit.patch.quantity === Number(item.quantity ?? 1) && !queue.get(hit.key)) return Promise.resolve();
        queue.set(hit.key, hit.patch);
        return Promise.resolve();
    }, [queue]);

    let saveState = 'idle';
    if (queue.inFlight()) saveState = 'saving';
    else if (queue.pending()) saveState = 'unsaved';

    return {
        order: optimisticOrder,
        syncing,
        saveState,
        tap,
        changeLine,
        flush: () => queue.flush(),
        busy: () => queue.busy(),
        pending: () => queue.pending(),
        inFlight: () => queue.inFlight(),
        failures: () => queue.failures(),
        discardPending: () => queue.clear(),
        latest: () => latest.current,
    };
}
