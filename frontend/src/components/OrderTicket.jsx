import React from 'react';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { PersonOrderSummary } from '@/components/OrderSummary';
import { OrderNote } from '@/components/OrderComposer';

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
    saving = false,
    draftUnits = 0,
    sendLabel = null,
    showSend = false,
    onChangeQty,
    onNotes,
    onApplyNote,
    onVoid,
    onSend,
    onClear,
    onClose = null,
    className = '',
}) {
    if (!order) return null;
    const total = order.total != null ? Number(order.total) : 0;

    return (
        <section
            className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 ${className}`}
            data-testid={`${testIdPrefix}-ticket`}
        >
            <header className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold">
                    Pedido nuevo{draftUnits > 0 ? ` · ${draftUnits} nuevo${draftUnits === 1 ? '' : 's'}` : ''}
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
                items={items}
                orderStatus={order.status}
                canEdit={canEdit}
                saving={saving}
                onChangeQty={onChangeQty}
                onNotes={onNotes}
                onApplyNote={onApplyNote}
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
                        className="min-h-[54px] w-full text-base font-bold"
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
