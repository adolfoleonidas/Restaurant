import React from 'react';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import { ChevronLeft } from 'lucide-react';
import MoreActions from '@/components/MoreActions';

export default function SheetHeader({ composerOpen, leaveComposer, closeSheet, t, loading, moreActions, accountTable, order, floor }) {
    const s = FLOOR_STYLE[floor.key];

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={composerOpen ? () => leaveComposer() : closeSheet}
                aria-label={composerOpen ? 'Volver a la mesa' : 'Volver al salón'}
                data-testid="mesa-sheet-volver"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border"
                style={{ borderColor: s.border, color: s.fg, background: 'hsl(var(--card))' }}
            >
                <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-2xl font-bold">
                    {composerOpen ? `Pedido · Mesa ${t.number}` : `Mesa ${t.number}`}
                </h2>
                {composerOpen ? null : (
                    <p className="text-sm font-semibold" style={{ color: s.fg }}>{s.label}</p>
                )}
            </div>
            {loading && (
                <span className="shrink-0 text-sm text-muted-foreground">Cargando pedido…</span>
            )}
            {/* S13: las acciones ocasionales viven en este
                botón de tres puntitos, alineado a la derecha
                de la cabecera; la barra baja queda para las
                dos acciones del día a día. */}
            {!composerOpen && moreActions.length > 0 && (
                <MoreActions
                    testId={accountTable && order ? 'mesa-sheet-mas-grupo' : 'mesa-sheet-mas'}
                    actions={moreActions}
                />
            )}
        </div>
    );
}
