import React from 'react';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { editableItems, itemsTotal } from '@/lib/orderDraft';
import { accountTally, tallyLabel } from './selectors';

export default function MiniOrderBar({ miniOrder, lastOpened, deliver, requestSend, openTrackedSheet }) {
    const order = miniOrder;
    const trackedTable = lastOpened.table;
    const tally = accountTally(order);
    const total = order.total != null ? fmtMoney(order.total) : '—';
    const statusSummary = `${tallyLabel(tally)} · ${total}`;
    const draftsAmount = itemsTotal(editableItems(order.items || [], order.status));
    // S14: la acción de borradores dice "Enviar a cocina" (con unidades
    // y monto) y pasa por el paso de confirmación, igual que el ticket.
    const actionVerb = tally.ready > 0
        ? 'Servir'
        : tally.drafts > 0
            ? `Enviar a cocina · ${tally.drafts} · ${fmtMoney(draftsAmount)}`
            : 'Agregar';
    const runAction = () => {
        if (tally.ready > 0) return deliver(order.id);
        if (tally.drafts > 0) return requestSend(order.id);
        return openTrackedSheet();
    };
    return (
        <div
            data-testid="salon-mini"
            className="fixed left-3 right-3 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] z-30 mx-auto flex max-w-md items-center gap-2 rounded-sm border border-border bg-card p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)] md:bottom-0"
        >
            <button
                type="button"
                onClick={openTrackedSheet}
                aria-label={`Pedido activo: Mesa ${trackedTable?.number}. ${statusSummary}`}
                className="flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left transition-colors active:bg-secondary sm:min-h-9"
            >
                <span
                    aria-hidden="true"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary font-display text-base font-bold"
                >
                    {trackedTable?.number}
                </span>
                <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold leading-tight">
                        {order.customer_name || `Cuenta #${order.order_number}`}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                        Mesa {trackedTable?.number} · {statusSummary}
                    </span>
                </span>
            </button>
            <Button size="sm" className="shrink-0" onClick={runAction} data-testid="salon-mini-accion">
                {actionVerb}
            </Button>
        </div>
    );
}
