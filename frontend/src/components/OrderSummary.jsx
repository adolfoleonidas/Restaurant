import React, { useState } from 'react';
import { Ban, ChevronDown, ChevronUp, Minus, Plus, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney } from '@/lib/format';
import { itemState, summaryLine, peopleLabel } from '@/lib/orderDraft';

const TONE_CLASS = {
    draft: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    kitchen: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
    ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    done: 'border-border bg-secondary text-muted-foreground',
    void: 'border-destructive/40 bg-destructive/10 text-destructive',
};

function StateChip({ item, orderStatus, testIdPrefix }) {
    const state = itemState(item, orderStatus);
    return (
        <span
            data-testid={`${testIdPrefix}-item-estado-${item.id}`}
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${TONE_CLASS[state.tone] || TONE_CLASS.done}`}
        >
            {state.label}
        </span>
    );
}

/**
 * Resumen de una persona: lo que pidió, con sus observaciones y sus acciones.
 * Lo que sigue en borrador se corrige libremente; lo que ya salió a cocina se
 * anula, no se borra.
 */
export function PersonOrderSummary({
    items = [],
    orderStatus,
    canEdit = false,
    saving = false,
    onChangeQty,
    onNotes,
    onVoid,
    testIdPrefix = 'mesa-sheet',
}) {
    const [notesDraft, setNotesDraft] = useState({});
    const [voidingId, setVoidingId] = useState(null);
    const [voidReason, setVoidReason] = useState('');

    // Se muestran todos, incluidos los anulados: el mozo tiene que poder ver que
    // existieron y por qué se anularon.
    const visible = items;

    const commitNotes = (item) => {
        const value = notesDraft[item.id];
        setNotesDraft((cur) => {
            const copy = { ...cur };
            delete copy[item.id];
            return copy;
        });
        if (value !== undefined && value !== (item.notes || '')) onNotes?.(item, value);
    };

    const confirmVoid = (item) => {
        const reason = voidReason.trim();
        if (reason.length < 3) return;
        setVoidingId(null);
        setVoidReason('');
        onVoid?.(item, reason);
    };

    return (
        <div className="space-y-2">
            <div className="divide-y rounded-xl border" data-testid={`${testIdPrefix}-items`}>
                {visible.map((item) => {
                    const state = itemState(item, orderStatus);
                    const draft = state.key === 'pendiente';
                    const voided = state.key === 'anulado';
                    const editingNotes = Object.prototype.hasOwnProperty.call(notesDraft, item.id);
                    const notesValue = editingNotes ? notesDraft[item.id] : (item.notes || '');
                    return (
                        <div key={item.id} className="space-y-1.5 px-3 py-2" data-testid={`${testIdPrefix}-item-${item.id}`}>
                            <div className="flex items-center justify-between gap-2 text-sm">
                                <span className={`min-w-0 truncate ${voided ? 'line-through opacity-60' : ''}`}>
                                    {item.quantity}× {item.product_name}
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                    <StateChip item={item} orderStatus={orderStatus} testIdPrefix={testIdPrefix} />
                                    <span className={`font-mono tabular-nums ${voided ? 'line-through opacity-60' : ''}`}>
                                        {fmtMoney(item.subtotal)}
                                    </span>
                                </span>
                            </div>
                            {!voided && (
                                <div className="flex items-center gap-1.5">
                                    {draft ? (
                                        <Input
                                            className="h-8 text-xs"
                                            placeholder="Observaciones (sin ensalada, sin cebolla…)"
                                            value={notesValue}
                                            disabled={!canEdit}
                                            onChange={(e) => setNotesDraft((cur) => ({ ...cur, [item.id]: e.target.value }))}
                                            onBlur={() => commitNotes(item)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') commitNotes(item); }}
                                            data-testid={`${testIdPrefix}-item-notas-${item.id}`}
                                        />
                                    ) : (
                                        // Lo que ya está en cocina no se edita en silencio: se
                                        // muestra tal como viajó y se cambia anulando y repitiendo.
                                        <span
                                            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                                            data-testid={`${testIdPrefix}-item-notas-${item.id}`}
                                        >
                                            {item.notes || 'Sin observaciones'}
                                        </span>
                                    )}
                                    {draft && canEdit && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => onChangeQty?.(item, -1)}
                                                disabled={saving}
                                                aria-label={`Quitar uno de ${item.product_name}`}
                                                data-testid={`${testIdPrefix}-item-menos-${item.id}`}
                                                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border hover:bg-secondary"
                                            >
                                                <Minus className="h-3.5 w-3.5" />
                                            </button>
                                            <span className="grid h-8 w-6 shrink-0 place-items-center font-mono text-sm tabular-nums">
                                                {item.quantity}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onChangeQty?.(item, 1)}
                                                disabled={saving}
                                                aria-label={`Agregar uno de ${item.product_name}`}
                                                data-testid={`${testIdPrefix}-item-mas-${item.id}`}
                                                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border hover:bg-secondary"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </button>
                                        </>
                                    )}
                                    {!draft && canEdit && voidingId !== item.id && (
                                        <button
                                            type="button"
                                            onClick={() => { setVoidingId(item.id); setVoidReason(''); }}
                                            data-testid={`${testIdPrefix}-item-anular-${item.id}`}
                                            className="flex shrink-0 items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                                        >
                                            <Ban className="h-3 w-3" /> Anular producto
                                        </button>
                                    )}
                                </div>
                            )}
                            {voidingId === item.id && (
                                <div className="flex items-center gap-1.5" data-testid={`${testIdPrefix}-item-anular-panel-${item.id}`}>
                                    <Input
                                        className="h-8 text-xs"
                                        placeholder="Motivo de la anulación"
                                        value={voidReason}
                                        autoFocus
                                        onChange={(e) => setVoidReason(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') confirmVoid(item); }}
                                        data-testid={`${testIdPrefix}-item-anular-motivo-${item.id}`}
                                    />
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-8 shrink-0"
                                        disabled={voidReason.trim().length < 3}
                                        onClick={() => confirmVoid(item)}
                                        data-testid={`${testIdPrefix}-item-anular-confirmar-${item.id}`}
                                    >
                                        Anular
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 shrink-0"
                                        onClick={() => { setVoidingId(null); setVoidReason(''); }}
                                        data-testid={`${testIdPrefix}-item-anular-cancelar-${item.id}`}
                                    >
                                        Cancelar
                                    </Button>
                                </div>
                            )}
                            {voided && item.void_reason && (
                                <p className="text-[11px] text-muted-foreground">Anulado: {item.void_reason}</p>
                            )}
                        </div>
                    );
                })}
                {visible.length === 0 && (
                    <p className="px-3 py-3 text-center text-xs text-muted-foreground">Todavía no pidió nada.</p>
                )}
            </div>
        </div>
    );
}

/**
 * Resumen general de la mesa: una barra con icono de recibo arriba del todo.
 *
 * Muestra el total y cuántos platos hay sin necesidad de abrirla, porque el
 * mozo necesita ese dato de reojo; el detalle agrupado se despliega al tocarla
 * para no empujar hacia abajo la carta, que es lo que usa todo el tiempo.
 */
export function TableSummary({
    rows = [],
    accounts = 0,
    dishes = 0,
    total = 0,
    testIdPrefix = 'mesa-sheet',
}) {
    const [open, setOpen] = useState(false);
    const empty = rows.length === 0;

    return (
        <div className="rounded-xl border" data-testid={`${testIdPrefix}-resumen`}>
            <button
                type="button"
                onClick={() => setOpen((cur) => !cur)}
                aria-expanded={open}
                data-testid={`${testIdPrefix}-resumen-toggle`}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-secondary/60"
            >
                <span className="flex min-w-0 items-center gap-1.5">
                    <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="page-kicker">Resumen de mesa</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                    {!empty && (
                        <span className="text-xs text-muted-foreground tabular-nums">{dishes} platos</span>
                    )}
                    <span className="font-mono text-sm font-semibold tabular-nums">{fmtMoney(total)}</span>
                    {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
            </button>
            {open && (
                <div className="border-t px-3 py-2">
                    {empty ? (
                        <p className="text-xs text-muted-foreground">La mesa todavía no pidió nada.</p>
                    ) : (
                        <ul className="space-y-0.5">
                            {rows.map((row) => (
                                <li
                                    key={row.key}
                                    className="flex items-baseline justify-between gap-2 text-sm"
                                    data-testid={`${testIdPrefix}-resumen-fila-${row.product_id}${row.notes ? '-con-observacion' : ''}`}
                                >
                                    <span className="min-w-0 truncate">
                                        {summaryLine(row)}
                                        {accounts > 1 && peopleLabel(row) && (
                                            <span className="ml-1 text-[11px] text-muted-foreground">— {peopleLabel(row)}</span>
                                        )}
                                    </span>
                                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                        {fmtMoney(row.subtotal)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
