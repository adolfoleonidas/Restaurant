/**
 * Saves what a previous session left on the device (BS-03).
 *
 * A reload, a crash or a dead battery can end the app with taps that were never
 * confirmed. They are kept on the device (see `outboxStorage`) and sent from here
 * when the app starts for that user and when the connection comes back, as the
 * same idempotent batch the composer would have sent: a line the server already
 * has is found by its id and changes nothing, so replaying twice, or racing with
 * the composer that wrote them, never duplicates a line.
 *
 * Orders that a live composer holds are skipped: it saves its own taps, and
 * removing the record under it could erase taps it has not saved yet.
 */
import { saveDraftLines } from '@/lib/api/orders';
import { buildDraftLine } from '@/lib/draftLines';
import { isTransientError } from '@/lib/lineSyncQueue';
import { ownsOrder } from '@/lib/outboxRegistry';
import { outboxStorage } from '@/lib/outboxStorage';

const CONFLICT_RETRIES = 2;

const sendWithRetries = async (send, orderId, lines) => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            // eslint-disable-next-line no-await-in-loop
            return await send(orderId, lines);
        } catch (error) {
            if (error?.response?.status !== 409 || attempt >= CONFLICT_RETRIES) throw error;
        }
    }
};

/**
 * Resolves `{ orders, sent, rejected, kept }`: how many stored orders were looked
 * at, how many lines the server accepted and refused, and how many orders stay on
 * the device because the connection failed (they are tried again later).
 */
export async function replayStoredOutboxes(userId, {
    storage = outboxStorage, send = saveDraftLines, owned = ownsOrder,
} = {}) {
    const summary = {
        orders: 0, sent: 0, rejected: 0, kept: 0,
    };
    if (!userId) return summary;
    const stored = await storage.list(userId);
    for (const { orderId, entries, signature } of stored) {
        if (owned(orderId)) continue; // eslint-disable-line no-continue
        summary.orders += 1;
        // The order is not loaded here, so nothing can be netted out against it: every line is sent.
        const lines = entries.map((entry) => buildDraftLine(entry, [])).filter(Boolean);
        try {
            if (lines.length) {
                // eslint-disable-next-line no-await-in-loop
                const response = await sendWithRetries(send, orderId, lines);
                const refused = (response?.data?.line_results || []).filter((report) => report.result === 'rejected').length;
                summary.rejected += refused;
                summary.sent += lines.length - refused;
            }
            // eslint-disable-next-line no-await-in-loop
            await storage.remove(userId, orderId, { ifSignature: signature });
        } catch (error) {
            if (isTransientError(error)) {
                summary.kept += 1;
            } else {
                // The server refused the batch (the order was paid, cancelled, ...): it will not change its mind.
                summary.rejected += lines.length;
                // eslint-disable-next-line no-await-in-loop
                await storage.remove(userId, orderId, { ifSignature: signature });
            }
        }
    }
    return summary;
}
