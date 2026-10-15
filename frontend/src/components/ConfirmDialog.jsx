import React from 'react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Shared confirmation for risky actions. Replaces `window.confirm`, which cannot
 * be styled, is blocked in some in-app browsers and reads differently per device.
 * The confirm button keeps the name of the action it confirms.
 *
 * `pending` blocks both buttons while the action is in flight: the dialog used to
 * stay live after the confirming tap, so a second tap sent the same action twice.
 */
export default function ConfirmDialog({
    open, title, description, confirmLabel, cancelLabel = 'Cancelar',
    destructive = true, pending = false, onConfirm, onCancel,
}) {
    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!next && !pending) onCancel?.(); }}>
            <AlertDialogContent data-testid="confirm-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending} data-testid="confirm-dialog-cancel">{cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        variant={destructive ? 'destructive' : undefined}
                        disabled={pending}
                        data-testid="confirm-dialog-confirm"
                        onClick={() => { if (!pending) onConfirm?.(); }}
                    >
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
