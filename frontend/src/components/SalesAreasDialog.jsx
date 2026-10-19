import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ORDER_AREAS, ORDER_TYPE_LABELS } from '@/lib/format';

/**
 * Composer URL for a picked area. Dine-in needs its table; without one there is
 * nowhere to go yet, so callers get `null` instead of a half-built order.
 */
export function newOrderPath(type, table) {
    if (type === 'mesa') return table ? `/pedidos/nuevo?mesa=${table.id}` : null;
    return `/pedidos/nuevo?tipo=${type}`;
}

/**
 * Sales areas — the first decision of every order (dine-in, takeaway, pickup or
 * delivery). Every entry point opens this dialog, so no shortcut drops the
 * waiter straight into the composer or seats a table before the area is known.
 *
 * `pendingTable` is the table the dialog was opened for (a card or the table
 * sheet); without it "Mesa" asks which table to use. `tablesError` is true when
 * the floor failed to load, so the grid says so instead of "no tables available".
 */
export default function SalesAreasDialog({ open, onOpenChange, pendingTable = null, tables = [], tablesError = false, onSelect }) {
    const [pickedType, setPickedType] = useState(null);

    const availableTables = useMemo(
        () => (tables || []).filter((t) => t.status === 'disponible' && !t.active_order && !t.active_attention_id)
            .sort((a, b) => Number(a.number) - Number(b.number)),
        [tables]
    );

    const close = () => {
        setPickedType(null);
        onOpenChange?.(false);
    };

    const chooseArea = (type) => {
        // Dine-in needs a table: the one already in hand, or a pick from the grid.
        if (type === 'mesa' && !pendingTable) {
            setPickedType('mesa');
            return;
        }
        setPickedType(null);
        onSelect?.(type, type === 'mesa' ? pendingTable : null);
    };

    const pickTable = (table) => {
        setPickedType(null);
        onSelect?.('mesa', table);
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
            <DialogContent className="sm:max-w-lg" data-testid="areas-venta">
                <DialogHeader>
                    <DialogTitle className="font-display text-2xl">Áreas de venta</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    {pendingTable && (
                        <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-testid="areas-venta-mesa">
                            Pedido para <strong>Mesa {pendingTable.number}</strong>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        {ORDER_AREAS.map((area) => (
                            <button
                                key={area.key}
                                type="button"
                                onClick={() => chooseArea(area.key)}
                                data-testid={`area-${area.key}`}
                                className={`flex min-h-[96px] flex-col items-start justify-center gap-1 rounded-xl border-2 p-4 text-left ${
                                    pickedType === area.key
                                        ? 'border-primary bg-primary/10'
                                        : 'border-border hover:border-primary hover:bg-primary/5'
                                }`}
                            >
                                <span className="font-display text-xl font-semibold">{ORDER_TYPE_LABELS[area.key]}</span>
                                <span className="text-xs text-muted-foreground">{area.hint}</span>
                            </button>
                        ))}
                    </div>
                    {pickedType === 'mesa' && !pendingTable && (
                        tablesError ? (
                            <p role="alert" className="text-sm text-destructive text-center py-4" data-testid="areas-venta-error">
                                No se pudieron cargar las mesas. Revisa tu conexión y vuelve a intentar.
                            </p>
                        ) : availableTables.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No hay mesas disponibles en este momento.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 max-h-[50dvh] overflow-y-auto" data-testid="areas-venta-mesas">
                                {availableTables.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => pickTable(t)}
                                        data-testid={`mesa-disponible-${t.number}`}
                                        className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5"
                                    >
                                        <span className="font-display text-2xl font-bold">{t.number}</span>
                                        <span className="text-xs text-muted-foreground mt-1">{t.area}</span>
                                    </button>
                                ))}
                            </div>
                        )
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={close} data-testid="areas-venta-cancelar">Cancelar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
