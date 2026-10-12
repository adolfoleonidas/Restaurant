import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/apiError';

const FALLBACK_MESSAGE = 'No se pudo completar la acción';

/**
 * One shared way for a button to show that its request is in flight.
 *
 * `run(key, fn, { errorMessage, onError })` runs `fn` once per key: a repeat tap
 * while the same key is pending is ignored (no second request) and resolves to
 * `undefined`. Failures are shown through `apiErrorMessage`. `pending` is the Set
 * of keys in flight, so a control can read `pending.has(key)` to disable itself
 * and swap its label (see `PendingButton`).
 */
export default function usePendingAction() {
    const inflight = useRef(new Set());
    const mounted = useRef(true);
    const [pending, setPending] = useState(() => new Set());

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const sync = () => { if (mounted.current) setPending(new Set(inflight.current)); };

    const run = useCallback(async (key, fn, { errorMessage = FALLBACK_MESSAGE, onError } = {}) => {
        if (inflight.current.has(key)) return undefined;
        inflight.current.add(key);
        sync();
        try {
            return await fn();
        } catch (e) {
            onError?.(e);
            toast.error(apiErrorMessage(e, errorMessage));
            return undefined;
        } finally {
            inflight.current.delete(key);
            sync();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return [run, pending];
}
