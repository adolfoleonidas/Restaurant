/**
 * What one outbox entry asks the server to do, in the shape of a batch line
 * (`PUT /orders/:id/draft-lines`): `{ client_line_id, quantity, product_id? }`.
 *
 * `known` is the last order the server confirmed (its items). An entry that
 * would leave the server exactly as it is returns null, so a "+" and a "-" in
 * the same pause cost no request. The exception is an entry that already went
 * out once (`attempted`): its answer may have been lost, so the server may hold
 * a different quantity than `known` says, and it is always sent again.
 */
const findLine = (known, entry) => known.find((item) => (
    (entry.lineId && item.id === entry.lineId)
    || (entry.clientLineId && item.client_line_id === entry.clientLineId)
));

/** The id the server knows a line by in a batch: the client id it was created with, else its own id. */
export function clientLineIdOf(entry, known = []) {
    return entry.clientLineId || findLine(known, entry)?.client_line_id || entry.lineId;
}

export function buildDraftLine(entry, known = []) {
    const quantity = Math.max(0, Number(entry.quantity || 0));
    const clientLineId = clientLineIdOf(entry, known);
    if (!clientLineId) return null;
    const attempted = Boolean(entry.attempted);

    if (entry.lineId) {
        // A line the server already had: nothing to send if it already holds this quantity.
        const existing = findLine(known, entry);
        if (!attempted && existing && Number(existing.quantity) === quantity) return null;
        return { client_line_id: clientLineId, quantity };
    }
    // A product with no line yet: nothing to create if the taps netted out to zero.
    if (!attempted && quantity === 0) return null;
    return { client_line_id: clientLineId, product_id: entry.productId, quantity };
}
