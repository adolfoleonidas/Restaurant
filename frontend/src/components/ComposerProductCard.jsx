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
    pulsing,
    testIdPrefix,
    onAdd,
    onRemove,
}) {
    const p = product;
    return (
        <div
            data-testid={`${testIdPrefix}-producto-fila-${p.id}`}
            className={`relative flex min-h-[84px] flex-col rounded-xl border bg-card p-3 transition-colors ${out ? 'opacity-50' : 'hover:border-primary/60'} ${pulsing ? 'composer-pulse' : ''}`}
        >
            {/* La tarjeta entera agrega, como el `.p` del mockup:
                nombre a dos líneas y precio debajo. */}
            <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(p)}
                data-testid={`${testIdPrefix}-producto-nombre-${p.id}`}
                className="flex w-full flex-1 min-w-0 flex-col justify-between gap-1.5 text-left"
            >
                <span className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmtMoney(p.price)}</span>
            </button>
            {/* Stepper en línea: aparece cuando el producto ya está en la
                cuenta. La fila siempre ocupa su alto (invisible sin unidades)
                para que la tarjeta no salte al agregar el primero. "−" sólo
                toca el borrador; lo ya enviado se anula desde el resumen. */}
            <div className={`mt-2 flex items-center justify-between ${qty > 0 ? '' : 'invisible'}`}>
                <button
                    type="button"
                    disabled={busy || qty === 0 || !canRemove}
                    onClick={(e) => { e.stopPropagation(); onRemove(p); }}
                    aria-label={`Quitar uno de ${p.name}`}
                    data-testid={`${testIdPrefix}-producto-menos-${p.id}`}
                    className="touch-target-coarse grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                >
                    <Minus className="h-4 w-4" />
                </button>
                <span
                    className={`text-sm font-bold tabular-nums ${qty > 0 ? '' : 'text-muted-foreground'} ${pulsing ? 'composer-pulse' : ''}`}
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
                    className="touch-target-coarse grid h-8 w-8 place-items-center rounded-lg border border-border transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export default memo(ComposerProductCard);
