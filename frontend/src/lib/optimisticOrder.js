/**
 * What the order looks like while taps are still on their way to the server.
 *
 * `overlayPendingLines` lays the queue's pending entries over the last order the
 * server confirmed, so the card steppers, the ticket and the send bar all read
 * the same optimistic quantities. `resolveTap` turns a tap on a product into the
 * queue entry that carries it. Both are pure.
 *
 * Entries (see `lineSyncQueue`):
 *   { kind: 'line', orderId, lineId, quantity }            an existing line
 *   { kind: 'new', productId, product, orderId, quantity } a product with no line
 *     yet; once the server creates the line the entry is bound with `lineId` and
 *     behaves like a line entry from then on.
 */
import { isCancelled, isDraft } from './orderDraft';

const round = (value) => Math.round(value * 100) / 100;

const hasNotes = (item) => Boolean(String(item?.notes || '').trim());

/** Draft lines of the product with no notes: what a "+" merges into. */
export function plainDraftLines(order, productId) {
    return (order?.items || []).filter((item) => (
        item.product_id === productId
        && !isCancelled(item)
        && isDraft(item, order?.status)
        && !hasNotes(item)
    ));
}

/** First draft line of the product with no notes: the one a "+" merges into. */
export function plainDraftLine(order, productId) {
    return plainDraftLines(order, productId)[0] || null;
}

function unitPrice(item) {
    if (item.unit_price != null) return Number(item.unit_price) || 0;
    const quantity = Number(item.quantity || 0);
    return quantity > 0 ? Number(item.subtotal || 0) / quantity : 0;
}

export function overlayPendingLines(order, entries, placeholder) {
    const list = Object.entries(entries || {});
    if (!list.length) return order;
    const needsPlaceholder = list.some(([, entry]) => entry.kind === 'new' && !entry.lineId);
    if (!order && !needsPlaceholder) return order;
    const base = order || placeholder;

    let items = [...(base.items || [])];
    let total = Number(base.total || 0);
    let changed = false;

    list.forEach(([key, entry]) => {
        const quantity = Math.max(0, Number(entry.quantity || 0));
        if (entry.lineId) {
            const index = items.findIndex((item) => item.id === entry.lineId);
            if (index < 0) return;
            const item = items[index];
            const subtotal = round(unitPrice(item) * quantity);
            total += subtotal - Number(item.subtotal || 0);
            changed = true;
            if (quantity === 0) items = items.filter((_, i) => i !== index);
            else items[index] = { ...item, quantity, subtotal, __key: key };
            return;
        }
        if (entry.kind !== 'new' || quantity === 0) return;
        const price = Number(entry.product?.price || 0);
        const subtotal = round(price * quantity);
        total += subtotal;
        changed = true;
        items.push({
            id: `pending:${key}`,
            __key: key,
            __virtual: true,
            product_id: entry.productId,
            product_name: entry.product?.name,
            quantity,
            unit_price: price,
            subtotal,
            status: 'borrador',
            notes: null,
        });
    });

    if (!changed) return order;
    return { ...base, items, total: round(total) };
}

/**
 * The queue entry for one tap. `order` is the optimistic order (already overlaid),
 * so a second tap builds on the first even if the server has not heard of it.
 * Returns `{ key, patch }` or null when there is nothing to do.
 */
export function resolveTap(order, product, direction) {
    const drafts = (order?.items || []).filter((item) => (
        item.product_id === product.id && !isCancelled(item) && isDraft(item, order?.status)
    ));
    // "+" merges into the plain draft line; "-" takes from the last draft line,
    // annotated or not. Sent lines are never touched from the card.
    const target = direction > 0 ? drafts.find((item) => !hasNotes(item)) : drafts[drafts.length - 1];

    if (!target) {
        if (direction < 0) return null;
        return {
            key: `new:${product.id}`,
            patch: {
                kind: 'new', productId: product.id, product, orderId: order?.id || null, quantity: 1,
            },
        };
    }

    const quantity = Math.max(0, Number(target.quantity || 0) + direction);
    if (target.__key) return { key: target.__key, patch: { quantity } };
    return {
        key: `line:${target.id}`,
        patch: { kind: 'line', orderId: order?.id || null, lineId: target.id, quantity },
    };
}

/** The entry for a "+"/"-" on a specific line (the ticket stepper). */
export function resolveLineChange(item, delta, orderId) {
    const quantity = Math.max(0, Number(item.quantity ?? 1) + delta);
    if (item.__key) return { key: item.__key, patch: { quantity } };
    return {
        key: `line:${item.id}`,
        patch: { kind: 'line', orderId: orderId || null, lineId: item.id, quantity },
    };
}
