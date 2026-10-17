// Shared guards for the two SSE loops (NotifyContext, usePublicStream) so a
// connection that died silently is detected instead of waited on forever.

// The backend writes a `: ping` comment every 15 s (routes/notifications.py,
// routes/public.py). Three missed pings means the connection is dead even if
// the browser has not noticed (captive portal, half-open mobile link).
export const STREAM_IDLE_MS = 45000;

export const STREAM_BACKOFF_BASE_MS = 1500;
export const STREAM_BACKOFF_CAP_MS = 30000;

export class StreamIdleError extends Error {
    constructor(ms) {
        super(`stream idle for ${ms} ms`);
        this.name = 'StreamIdleError';
    }
}

/**
 * Delay before reconnect attempt number `attempt` (0-based): exponential from
 * the base, capped, with the lower half of the window randomised so a fleet of
 * clients that lost the server together does not come back in lockstep.
 */
export function nextBackoffMs(attempt, random = Math.random) {
    const exp = Math.min(STREAM_BACKOFF_CAP_MS, STREAM_BACKOFF_BASE_MS * (2 ** attempt));
    return exp / 2 + random() * (exp / 2);
}

/**
 * Settles like `promise`, unless it takes longer than `ms`: then `onIdle` runs
 * (to tear the connection down) and the result rejects with StreamIdleError.
 * Wrap each `reader.read()` so every received chunk (events and pings) re-arms it.
 */
export function withIdleTimeout(promise, ms, onIdle) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (onIdle) onIdle();
            reject(new StreamIdleError(ms));
        }, ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}
