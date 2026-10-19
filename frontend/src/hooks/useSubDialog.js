import { useEffect, useRef } from 'react';

/**
 * Containment for the plain-div sub-dialogs of the charge dialog (verify, help,
 * history, QR). They sit inside the charge dialog's Radix content, so without this
 * Escape would dismiss the PARENT and focus would stay behind the sub-dialog.
 *
 * - On open, focus moves into the sub-dialog (the container, named by its title).
 * - Escape closes only the sub-dialog: it is handled and stopped here, and the
 *   charge dialog's `onEscapeKeyDown` refuses to dismiss while one is open.
 * - On close, focus goes back to whatever opened it, if that is still on the page.
 *
 * The Tab cycle is scoped by the charge dialog, which looks for `[data-cobro-subdialog]`.
 *
 * Spread `props` on the `role="dialog"` element.
 */
export default function useSubDialog(onClose) {
    const ref = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        const trigger = document.activeElement;
        ref.current?.focus();
        return () => {
            if (trigger && trigger !== document.body && document.contains(trigger)) trigger.focus();
        };
    }, []);

    const onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
    };

    return {
        props: {
            ref, tabIndex: -1, onKeyDown, 'data-cobro-subdialog': '',
        },
    };
}
