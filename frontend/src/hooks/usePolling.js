import { useEffect, useRef, useState, useCallback } from 'react';

export default function usePolling(fetcher, interval = 3000, deps = []) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);
    const stopped = useRef(false);

    const refetch = useCallback(async () => {
        try {
            const result = await fetcher();
            if (!stopped.current) {
                setData(result);
                setError(null);
            }
        } catch (e) {
            if (!stopped.current) setError(e);
        } finally {
            if (!stopped.current) setLoading(false);
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
