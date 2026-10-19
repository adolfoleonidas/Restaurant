import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs `loader` on mount and keeps the honest state of that load.
 *
 * `loader` fetches and stores the data itself (it throws on failure). This hook
 * only answers "is it loading, did it fail, did it ever work": `error` is the
 * last failure (cleared by the next success), `hasData` is true once a load has
 * worked (so a later failed refresh keeps the last data on screen), and
 * `retry()` is the "Reintentar" action — it shows the loading state again.
 *
 * `load()` never throws, so it is safe to await after a mutation ("save, then
 * reload the list") without turning a failed reload into a failed save.
 */
export default function useLoader(loader) {
    const [state, setState] = useState({ loading: true, error: null, hasData: false });
    const latest = useRef(loader);
    latest.current = loader;
    const alive = useRef(true);

    const load = useCallback(async () => {
        try {
            await latest.current();
            if (alive.current) setState({ loading: false, error: null, hasData: true });
        } catch (error) {
            if (alive.current) setState((current) => ({ ...current, loading: false, error }));
        }
    }, []);

    const retry = useCallback(() => {
        setState((current) => ({ ...current, loading: true, error: null }));
        return load();
    }, [load]);

    useEffect(() => {
        alive.current = true;
        load();
        return () => { alive.current = false; };
    }, [load]);

    return { ...state, load, retry };
}
