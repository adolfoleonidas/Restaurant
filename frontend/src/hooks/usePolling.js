import { useEffect, useRef, useState, useCallback } from 'react';

export default function usePolling(fetcher, interval = 3000, deps = []) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);
    const stopped = useRef(false);
    // Each request takes a number; only the newest one may write state, so a slow
    // older response can never overwrite a newer one.
    const requestId = useRef(0);

    const refetch = useCallback(async () => {
        requestId.current += 1;
        const mine = requestId.current;
        const current = () => !stopped.current && mine === requestId.current;
        try {
            const result = await fetcher();
            if (current()) {
                setData(result);
                setError(null);
            }
        } catch (e) {
            if (current()) setError(e);
        } finally {
            if (current()) setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useEffect(() => {
        stopped.current = false;
        refetch();
        const t = setInterval(() => {
            setTick((x) => x + 1);
            refetch();
        }, interval);
        return () => {
            stopped.current = true;
            clearInterval(t);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refetch, interval]);

    return { data, error, loading, tick, refetch };
}
