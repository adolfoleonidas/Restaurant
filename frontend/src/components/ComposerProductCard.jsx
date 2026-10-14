import React, { memo } from 'react';
import { Plus, Minus } from 'lucide-react';
import { fmtMoney } from '@/lib/format';

/**
 * One product of the composer grid.
 *
 * It is memoized and takes only primitives plus the product and two callbacks
 * that never change identity, so a tap re-renders the tapped card and leaves
 * the rest of the grid alone (the parent resolves the draft line to remove).
 */
function ComposerProductCard({
    product,
    qty,
    out,
    busy,
    canRemove,
    testIdPrefix,
    onAdd,
    onRemove,
}) {
    const p = product;
    return (
        <div
            data-testid={`${testIdPrefix}-producto-fila-${p.id}`}
            className={`composer-card relative flex min-h-[84px] touch-manipulation flex-col rounded-xl border bg-card ${out ? 'opacity-50' : 'hover:border-primary/60'}`}
        >
            {/* El botón ES la tarjeta: el relleno, el hueco del escalón (que queda
                invisible sin unidades) y el espacio entre nombre y precio también
                agregan. Antes solo el texto era botón, y en el teléfono del mozo eso
                se medía así: toques en la tarjeta que tardaban 2,5-4,5 s en "hacer
                algo" —hasta que tocaba el nombre— y se vivían como "no agarró".
                El escalón va encima y FUERA del botón: sus toques no lo disparan. */}
            <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(p)}
                data-testid={`${testIdPrefix}-producto-nombre-${p.id}`}
                className="flex w-full flex-1 min-w-0 touch-manipulation flex-col justify-between gap-1.5 p-3 pb-11 text-left"
            >
                <span className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmtMoney(p.price)}</span>
            </button>
            {/* Stepper en línea: aparece cuando el producto ya está en la cuenta.
                Va absoluto y fuera del botón: encima de la tarjeta cuando hay
                unidades, y sin recibir toques cuando está invisible —así ese hueco
                sigue agregando, que es lo que el mozo espera de una tarjeta grande. */}
            <div className={`absolute inset-x-3 bottom-2 flex items-center justify-between ${qty > 0 ? '' : 'invisible'}`}>
                <button
                    type="button"
                    disabled={busy || qty === 0 || !canRemove}
                    onClick={(e) => { e.stopPropagation(); onRemove(p); }}
                    aria-label={`Quitar uno de ${p.name}`}
                    data-testid={`${testIdPrefix}-producto-menos-${p.id}`}
                    className="touch-target-coarse touch-manipulation grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                >
                    <Minus className="h-4 w-4" />
                </button>
                <span
                    className={`text-sm font-bold tabular-nums ${qty > 0 ? '' : 'text-muted-foreground'}`}
                    data-testid={`${testIdPrefix}-producto-cantidad-${p.id}`}
                >
                    {qty}
                </span>
                <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); onAdd(p); }}
                    aria-label={`Agregar uno de ${p.name}`}
                    data-testid={`${testIdPrefix}-producto-${p.id}`}
                    className="touch-target-coarse touch-manipulation grid h-8 w-8 place-items-center rounded-lg border border-border hover:border-primary hover:bg-primary hover:text-primary-foreground"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export default memo(ComposerProductCard);
