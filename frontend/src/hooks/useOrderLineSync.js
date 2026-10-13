import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { saveDraftLines } from '@/lib/api/orders';
import { newClientId } from '@/lib/clientId';
import { buildDraftLine } from '@/lib/draftLines';
import { ORDER_SYNC_DELAY_MS, createLineSyncQueue } from '@/lib/lineSyncQueue';
import { overlayPendingLines, resolveLineChange, resolveTap } from '@/lib/optimisticOrder';
import { registerOutbox } from '@/lib/outboxRegistry';
import { outboxStorage } from '@/lib/outboxStorage';

/** The server's per-line report travels with the order; the screens only want the order. */
const withoutReport = ({ line_results: ignored, ...order }) => order;

/** A line the server rejected, as the error `apiErrorMessage` knows how to read. */
const rejection = (result) => ({ response: { status: 400, data: { detail: result.detail } } });

/** What the overlay needs of a product to draw a line that is not on the server yet. */
const slimProduct = (product) => (product ? { id: product.id, name: product.name, price: product.price } : product);

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
 * What is pending is also kept on the device, per user and order (see
 * `lib/outboxStorage`), so a reload, a crash or an app update does not lose it:
 * it is sent again when that order is opened. The outbox is also registered (see
 * `lib/outboxRegistry`) so logout and the service-worker update can save it first.
 *
 * The caller provides the pieces that depend on where the order lives:
 * - `ensureOrderId({ requestId })`: id of the order, creating it on the first
 *   product. It is called as soon as the first product is tapped, not after the
 *   pause, so the table shows as occupied. `requestId` names that one creation:
 *   a retry after a lost answer is called with the same one, so it must go in the
 *   create request (`request_id`) and the server hands back the order it already
 *   made instead of making another.
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
 * - `userId`: whose outbox it is on the device; without it nothing is kept there.
 */
export default function useOrderLineSync({
    order, placeholder, ensureOrderId, loadOrder, acceptOrder, onError, onStalled, onSynced,
    userId = null, storage = outboxStorage, delayMs = ORDER_SYNC_DELAY_MS,
}) {
    // What the outbox has not confirmed yet; a new object on every change, so the
    // screen re-renders whenever a tap is recorded or confirmed.
    const [entries, setEntries] = useState({});
    // The last order the server confirmed, as seen by the sync code. While a
    // request is on the wire it is refreshed by the outbox itself; otherwise by the render.
    const latest = useRef(order);
    const handlers = useRef({});
    handlers.current = {
        placeholder, ensureOrderId, loadOrder, acceptOrder, onError, onStalled, onSynced, userId, storage,
    };
    const queueRef = useRef(null);

    if (!queueRef.current) {
        // What is on the device for each order (by order id), so it is written only when it
        // changes and erased once the server has confirmed everything.
        const kept = new Map();
        const persist = () => {
            const { userId: owner, storage: store } = handlers.current;
            if (!owner || !store) return;
            const byOrder = new Map();
            Object.entries(queueRef.current.snapshot()).forEach(([key, entry]) => {
                // Without an order the entry has nothing to be attached to yet.
                if (!entry.orderId) return;
                if (!byOrder.has(entry.orderId)) byOrder.set(entry.orderId, []);
                byOrder.get(entry.orderId).push({ ...entry, key, product: slimProduct(entry.product) });
            });
            byOrder.forEach((list, orderId) => {
                const signature = JSON.stringify(list);
                if (kept.get(orderId) === signature) return;
                kept.set(orderId, signature);
                Promise.resolve(store.save(owner, orderId, list)).then((saved) => {
                    // Not written: try again with the next change instead of trusting it is there.
                    if (!saved && kept.get(orderId) === signature) kept.delete(orderId);
                });
            });
            [...kept.keys()].forEach((orderId) => {
                if (byOrder.has(orderId)) return;
                kept.delete(orderId);
                void store.remove(owner, orderId);
            });
        };

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
        const run = async ({ orderId, items }, { keepalive = false } = {}) => {
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
            // The flag must be on the device before the request, in case the page dies mid-flight.
            persist();

            const response = keepalive
                ? await saveDraftLines(orderId, lines, { keepalive: true })
                : await saveDraftLines(orderId, lines);
            const reports = new Map((response?.data?.line_results || []).map((report) => [report.client_line_id, report]));
            await confirmed(orderId, response);
            const rejected = sent
                .filter(({ clientLineId }) => reports.get(clientLineId)?.result === 'rejected')
                .map(({ key, clientLineId }) => ({ key, error: rejection(reports.get(clientLineId)) }));
            return { rejected };
        };

        queueRef.current = createLineSyncQueue({
            run,
            resolveOrder: (creation) => handlers.current.ensureOrderId(creation),
            delayMs,
            onChange: () => {
                setEntries(queueRef.current.snapshot());
                persist();
            },
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
    // When the page may disappear the batch goes out in a request that survives it.
    useEffect(() => {
        const saveNow = (options) => { if (queue.pending()) void queue.flush(options); };
        const onVisibility = () => { if (document.visibilityState === 'hidden') saveNow({ keepalive: true }); };
        const onPageHide = () => saveNow({ keepalive: true });
        const onOnline = () => saveNow();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('online', onOnline);
            saveNow();
        };
    }, [queue]);

    // Logout and the service-worker update ask every live outbox to save itself.
    useEffect(() => registerOutbox({
        pending: () => queue.pending(),
        flush: (options) => queue.flush(options),
        orderIds: () => [...new Set(Object.values(queue.snapshot()).map((entry) => entry.orderId).filter(Boolean))],
    }), [queue]);

    // Opening an order takes back what a previous session left unconfirmed on the device.
    const orderId = order?.id || null;
    useEffect(() => {
        if (!orderId || !userId || !storage) return undefined;
        let active = true;
        storage.load(userId, orderId).then((saved) => {
            if (active && saved.length) queue.restore(saved);
        }).catch(() => {});
        return () => { active = false; };
    }, [orderId, userId, storage, queue]);

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

    const changeLine = useCallback((item, delta, targetOrderId) => {
        const hit = resolveLineChange(item, delta, targetOrderId);
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
