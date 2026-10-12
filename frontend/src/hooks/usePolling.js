import { useEffect, useRef, useState, useCallback } from 'react';

// Payloads bigger than this are not kept as text to compare against: a poll that
// big is committed as it arrives rather than holding a second copy in memory.
const MAX_COMPARE_CHARS = 1_000_000;

/** Stable text form of a payload, or null when it cannot (or should not) be compared. */
function serialize(value) {
    try {
        const json = JSON.stringify(value);
        return typeof json === 'string' && json.length <= MAX_COMPARE_CHARS ? json : null;
    } catch {
        return null;
    }
}

/**
 * Polls `fetcher` every `interval` ms (and whenever `deps` change).
 *
 * A poll that brings back exactly what the screen already has commits nothing:
 * `data` keeps its identity and no component re-renders, which matters on slow
 * phones where every poll used to repaint the whole screen.
 */
export default function usePolling(fetcher, interval = 3000, deps = []) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const stopped = useRef(false);
    // Each request takes a number; only the newest one may write state, so a slow
    // older response can never overwrite a newer one.
    const requestId = useRef(0);
    // The text form of the data the screen currently shows.
    const shown = useRef(null);
    // What the screen shows for `error` and `loading`, so a poll that changes
    // neither does not even ask React to look at them again.
    const showsError = useRef(false);
    const showsLoading = useRef(true);

    const refetch = useCallback(async () => {
        requestId.current += 1;
        const mine = requestId.current;
        const current = () => !stopped.current && mine === requestId.current;
        try {
            const result = await fetcher();
            if (current()) {
                const next = serialize(result);
                if (next === null || next !== shown.current) {
                    shown.current = next;
                    setData(result);
                }
                if (showsError.current) {
                    showsError.current = false;
                    setError(null);
                }
            }
        } catch (e) {
            if (current()) {
                showsError.current = true;
                setError(e);
            }
        } finally {
            if (current() && showsLoading.current) {
                showsLoading.current = false;
                setLoading(false);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        stopped.current = false;
        refetch();
        const t = setInterval(refetch, interval);
        return () => {
            stopped.current = true;
            clearInterval(t);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refetch, interval]);

    return { data, error, loading, refetch };
}
