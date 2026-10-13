import React from 'react';

const LABELS = {
    saving: 'Guardando…',
    unsaved: 'Sin guardar',
};

const TONES = {
    saving: 'text-muted-foreground',
    unsaved: 'text-amber-700 dark:text-amber-300',
};

/**
 * Where the waiter's taps are: on the way to the server ("Guardando…") or still
 * waiting on the device ("Sin guardar"). Nothing is shown once they are saved.
 *
 * The region stays in the page when it is empty so a screen reader announces the
 * change. Plain text: the app has no motion.
 */
export default function SyncStatus({ state = 'idle', testId = 'sync-status', className = '' }) {
    const label = LABELS[state] || '';
    return (
        <span
            role="status"
            aria-live="polite"
            data-testid={testId}
            data-state={label ? state : 'idle'}
            className={`text-xs font-medium ${TONES[state] || ''} ${className}`.trim()}
        >
            {label}
        </span>
    );
}
