import React from 'react';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/apiError';

const FALLBACK = 'No se pudo cargar. Revisa tu conexión y reintenta.';

/**
 * One honest answer for "the data is not here": loading, failed, or empty.
 *
 * A failed load must never look like an empty list — a cashier on a bad
 * connection concludes "there is nothing" and creates what already exists. So
 * a screen wraps what it shows from the server in this component:
 *
 * - `loading` (and nothing shown yet): a quiet "Cargando…".
 * - `error` and nothing shown yet: the error with a "Reintentar" button, and
 *   NOT the children (a list drawn from `[]` would claim there is nothing).
 * - `error` but `hasData`: the last good data stays on screen under a warning,
 *   because a failed refresh says nothing about what was already read.
 * - `empty` (a load that really came back with nothing): `emptyText`.
 *
 * `testId` names the pieces: `${testId}-loading`, `${testId}-error`,
 * `${testId}-reintentar` and `${testId}-vacio`.
 */
export default function LoadState({
    loading = false,
    error = null,
    onRetry,
    hasData = false,
    empty = false,
    emptyText,
    loadingText = 'Cargando…',
    errorText = FALLBACK,
    testId = 'carga',
    children,
}) {
    const message = error
        ? (typeof error === 'string' ? error : apiErrorMessage(error, errorText))
        : null;

    const alert = message ? (
        <div
            role="alert"
            className="rounded-xl border border-destructive/50 p-3 text-sm text-destructive flex flex-wrap items-center gap-3"
            data-testid={`${testId}-error`}
        >
            <span className="min-w-0">{hasData ? `No se pudo actualizar: lo que ves puede estar desactualizado. ${message}` : message}</span>
            {onRetry && (
                <Button size="sm" variant="outline" className="h-9" onClick={onRetry} data-testid={`${testId}-reintentar`}>
                    Reintentar
                </Button>
            )}
        </div>
    ) : null;

    if (!hasData) {
        if (alert) return alert;
        if (loading) {
            return (
                <p className="text-sm text-muted-foreground" role="status" data-testid={`${testId}-loading`}>
                    {loadingText}
                </p>
            );
        }
    }
    if (empty && emptyText) {
        return (
            <>
                {alert}
                <p className="py-8 text-center text-sm text-muted-foreground" data-testid={`${testId}-vacio`}>{emptyText}</p>
            </>
        );
    }
    return (
        <>
            {alert}
            {children}
        </>
    );
}
