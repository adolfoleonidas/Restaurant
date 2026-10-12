import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addOrderItems, removeOrderItem, updateOrderItem } from '@/lib/api/orders';
import { createLineSyncQueue } from '@/lib/lineSyncQueue';
import {
    overlayPendingLines, plainDraftLines, resolveLineChange, resolveTap,
} from '@/lib/optimisticOrder';

/**
 * Optimistic quantities for an order composer.
 *
 * `order` is the last order the server confirmed. The hook returns that order
 * with the waiter's pending taps laid over it (`order`), plus `tap` and
 * `changeLine`, which only record what the waiter wants; a serial queue then
 * brings the server there (see `lib/lineSyncQueue`). Nothing is disabled while
 * it syncs, so a quick "+ + +" can never lose a tap.
 *
 * The caller provides the pieces that depend on where the order lives:
 * - `ensureOrderId()`: id of the order, creating it on the first product.
 * - `loadOrder(orderId)`: re-reads the order, applies it to the caller's state
 *   and returns it (null when it cannot be read). It must throw on network errors.
 * - `onError(error, entry)`: called once for each line that failed; the line has
 *   already been rolled back to the last confirmed quantity.
 * - `onSynced()`: called when the queue empties.
 * - `placeholder`: the empty order shown before the first product exists.
 */
export default function useOrderLineSync({
    order, placeholder, ensureOrderId, loadOrder, onError, onSynced,
}) {
    // What the queue has not confirmed yet; a new object on every change, so the
    // screen re-renders whenever a tap is recorded or confirmed.
    const [entries, setEntries] = useState({});
    // The last order the server confirmed, as seen by the sync code. While the
    // queue works it is refreshed by the queue itself; otherwise by the render.
    const latest = useRef(order);
    const handlers = useRef({});
    handlers.current = {
        placeholder, ensureOrderId, loadOrder, onError, onSynced,
    };
    const queueRef = useRef(null);

    if (!queueRef.current) {
        const run = async (key, entry) => {
            const sent = entry.quantity;
            if (entry.lineId) {
                const orderId = entry.orderId;
                const known = latest.current?.id === orderId
                    ? (latest.current.items || []).find((item) => item.id === entry.lineId)
                    : null;
                // The taps netted out to what the server already has.
                if (known && Number(known.quantity) === sent) return;
                if (sent <= 0) await removeOrderItem(orderId, entry.lineId);
                else await updateOrderItem(orderId, entry.lineId, { quantity: sent });
                const data = await handlers.current.loadOrder(orderId);
                if (data) latest.current = data;
                return;
            }
            // No line yet: nothing to create if the taps netted out to zero.
            if (sent <= 0) return;
            const orderId = await handlers.current.ensureOrderId();
            // The caller already told the waiter why there is no order: drop the taps quietly.
            if (!orderId) {
                entry.quantity = 0;
                return;
            }
            entry.orderId = orderId;
            const before = new Set(
                (latest.current?.id === orderId ? latest.current.items || [] : []).map((item) => item.id)
            );
            await addOrderItems(orderId, [{ product_id: entry.productId, quantity: sent }]);
            const data = await handlers.current.loadOrder(orderId);
            if (data) latest.current = data;
            const created = (data ? plainDraftLines(data, entry.productId) : [])
                .find((item) => !before.has(item.id)) || null;
            if (created) entry.lineId = created.id;
            // More taps are waiting on a line we cannot find: do not guess.
            else if (entry.quantity !== sent) throw new Error('Created line not found');
        };

        const publish = () => setEntries(queueRef.current.snapshot());
        queueRef.current = createLineSyncQueue({
            run,
            onChange: publish,
            onError: (key, error, entry) => handlers.current.onError?.(error, entry),
            onDrain: () => {
                publish();
                handlers.current.onSynced?.();
            },
        });
    }
    const queue = queueRef.current;

    useLayoutEffect(() => {
        if (!queue.busy()) latest.current = order;
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

    const optimisticOrder = useMemo(
        () => overlayPendingLines(order, entries, placeholder),
        [order, entries, placeholder]
    );

    const currentOptimistic = () => overlayPendingLines(latest.current, queue.snapshot(), handlers.current.placeholder);

    const tap = useCallback((product, direction) => {
        const hit = resolveTap(currentOptimistic(), product, direction);
        if (!hit) return Promise.resolve();
        queue.set(hit.key, hit.patch);
        return queue.whenIdle();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue]);

    const changeLine = useCallback((item, delta, orderId) => {
        const hit = resolveLineChange(item, delta, orderId);
        if (hit.patch.quantity === Number(item.quantity ?? 1) && !queue.get(hit.key)) return Promise.resolve();
        queue.set(hit.key, hit.patch);
        return queue.whenIdle();
    }, [queue]);

    return {
        order: optimisticOrder,
        syncing,
        tap,
        changeLine,
        flush: () => queue.whenIdle(),
        busy: () => queue.busy(),
        failures: () => queue.failures(),
        latest: () => latest.current,
    };
}
