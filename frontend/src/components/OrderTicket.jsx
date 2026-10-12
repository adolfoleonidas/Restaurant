import React from 'react';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { PersonOrderSummary } from '@/components/OrderSummary';
import { OrderNote } from '@/components/OrderComposer';
import { isDraft, itemsTotal } from '@/lib/orderDraft';

/**
 * Ticket del borrador, como el `.ticket` del prototipo: líneas con stepper y
 * nota, nota general, total y las acciones de enviar/vaciar.
 *
 * El mismo componente sirve la columna sticky de escritorio, el bloque en
 * flujo del móvil y la hoja inferior (con otro `testIdPrefix`), así ninguna
 * superficie duplica testids ni lógica.
 */
export default function OrderTicket({
    testIdPrefix = 'mesa-sheet',
    order = null,
    items = [],
    canEdit = false,
    canVoid = false,
    saving = false,
    draftUnits = 0,
    sendLabel = null,
    showSend = false,
    onChangeQty,
    onNotes,
    onVoid,
    onSend,
    onClear,
    onClose = null,
    className = '',
    draftOnly = false,
}) {
    if (!order) return null;
    const ticketItems = draftOnly ? items.filter((item) => isDraft(item, order.status)) : items;
    const total = draftOnly ? itemsTotal(ticketItems) : (order.total != null ? Number(order.total) : 0);

    return (
        <section
            className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 ${className}`}
            data-testid={`${testIdPrefix}-ticket`}
        >
            <header className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold">
                    Pedido nuevo
                </h3>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar pedido"
                        data-testid={`${testIdPrefix}-ticket-cerrar`}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-foreground"
                    >
                        ✕
                    </button>
                )}
            </header>

            <PersonOrderSummary
                testIdPrefix={testIdPrefix}
                items={ticketItems}
                orderStatus={order.status}
                canEdit={canEdit}
                canVoid={canVoid}
                saving={saving}
                // S12: lo enviado va en su bloque `.sent` (`#id · hh:mm` + tag);
                // las líneas van peladas, sin chip por ítem.
                sentMeta={draftOnly ? null : { number: order.order_number, at: order.created_at }}
                onChangeQty={onChangeQty}
                onNotes={onNotes}
                onVoid={onVoid}
            />

            <OrderNote order={order} testIdPrefix={testIdPrefix} />

            <div
                className="flex items-center justify-between gap-2 border-t border-dashed pt-2.5"
                data-testid={`${testIdPrefix}-pedido-resumen`}
            >
                <span className="text-sm font-semibold text-muted-foreground">Este pedido</span>
                <span className="font-mono text-lg font-extrabold tabular-nums">{fmtMoney(total)}</span>
            </div>

            <div className="grid gap-2">
                {showSend && (
                    <Button
                        className="fixed left-3 right-3 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom)+10px)] z-30
                            min-h-[54px] w-auto min-w-0 whitespace-normal text-base font-bold
                            min-[820px]:static min-[820px]:inset-auto min-[820px]:z-auto min-[820px]:w-full"
                        onClick={onSend}
                        data-testid={`${testIdPrefix}-enviar-cocina`}
                    >
                        {sendLabel || 'Enviar a cocina'}
                    </Button>
                )}
                {draftUnits > 0 && onClear && (
                    <button
                        type="button"
                        onClick={onClear}
                        data-testid={`${testIdPrefix}-vaciar`}
                        className="min-h-[46px] rounded-xl text-sm font-semibold text-destructive hover:bg-destructive/10"
                    >
                        Vaciar
                    </button>
                )}
            </div>
        </section>
    );
}
