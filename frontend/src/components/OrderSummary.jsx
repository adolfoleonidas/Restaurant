import React, { useState } from 'react';
import { Ban, ChevronDown, ChevronUp, Minus, Plus, Printer, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney, fmtTime } from '@/lib/format';
import { isSent, itemState, orderStateTag, peopleLabel, summaryLine } from '@/lib/orderDraft';

/**
 * Tonos del tag de estado POR PEDIDO (S12): el mismo par clave/color que usan
 * la cabecera de la tarjeta del detalle y la cabecera del bloque enviado del
 * ticket. `draft`/`empty` comparten el gris.
 */
export const KITCHEN_TONE = {
    empty: 'bg-secondary text-muted-foreground',
    draft: 'bg-secondary text-muted-foreground',
    kitchen: 'bg-[hsl(var(--chart-2))] text-[hsl(var(--background))]',
    ready: 'bg-[hsl(var(--warn))] text-[hsl(var(--background))]',
    done: 'bg-[hsl(var(--green))] text-[hsl(var(--background))]',
};

/**
 * Lo que lleva la persona seleccionada.
 *
 * `mode="ticket"` (compositor): los borradores tienen stepper `− n +`, un
 * botón 📝 Nota y la nota visible como texto chico; el input solo aparece al
 * editar. Lo enviado va primero, agrupado en el bloque `.sent` del mockup
 * (cabecera `#id · hh:mm` + tag de estado) con las líneas peladas.
 *
 * `mode="detail"` (detalle de mesa): lectura pura como el `.order` del mockup
 * —`qty × nombre`, nota y precio—; el estado del pedido vive UNA vez en el tag
 * de la cabecera de la tarjeta y las líneas van sin chip (S12).
 */
export function PersonOrderSummary({
    items = [],
    orderStatus,
    canEdit = false,
    canVoid = false,
    saving = false,
    mode = 'ticket',
    // { number, at } → bloque `.sent` del ticket (pedido enviado).
    sentMeta = null,
    onChangeQty,
    onNotes,
    onVoid,
    testIdPrefix = 'mesa-sheet',
}) {
    const [notesDraft, setNotesDraft] = useState({});
    const [voidingId, setVoidingId] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const detailMode = mode === 'detail';

    // Se muestran todos, incluidos los anulados: el mozo tiene que poder ver que
    // existieron y por qué se anularon.
    const visible = items;
    // S12: en el ticket lo enviado va en su bloque (patrón `.sent`); en el
    // detalle se respeta el orden del pedido (la tarjeta ya tiene su tag).
    const sentItems = sentMeta ? visible.filter((it) => isSent(it, orderStatus)) : [];
    const draftItems = sentMeta ? visible.filter((it) => !isSent(it, orderStatus)) : visible;
    const sentTag = sentMeta && sentItems.length ? orderStateTag(sentItems, orderStatus) : null;

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

    const renderItem = (item) => {
        const state = itemState(item, orderStatus);
        const draft = state.key === 'pendiente';
        const voided = state.key === 'anulado';
        const editingNotes = Object.prototype.hasOwnProperty.call(notesDraft, item.id);
        const notesValue = editingNotes ? notesDraft[item.id] : (item.notes || '');
        const editing = !detailMode && draft && editingNotes;
        const showControls = !detailMode && draft && canEdit;
        return (
            <div key={item.id} className="space-y-1.5 px-3 py-2" data-testid={`${testIdPrefix}-item-${item.id}`}>
                <div className="flex items-center justify-between gap-2 text-sm">
                    <span className={`min-w-0 truncate ${voided ? 'line-through opacity-60' : ''}`}>
                        {item.quantity}× {item.product_name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                        <span className={`font-mono tabular-nums ${voided ? 'line-through opacity-60' : ''}`}>
                            {fmtMoney(item.subtotal)}
                        </span>
                    </span>
                </div>
                {/* La nota viaja bajo el nombre, como el `— nota` del mockup. */}
                {!voided && !editing && item.notes ? (
                    <p
                        className="text-xs font-medium text-[hsl(var(--warn))]"
                        data-testid={`${testIdPrefix}-item-notas-${item.id}`}
                    >
                        {item.notes}
                    </p>
                ) : null}
                {!voided && (editing || showControls || (!draft && canEdit && voidingId !== item.id)) && (
                    <div className={`flex items-center gap-1.5 ${(!draft || detailMode) && !editing ? 'justify-end' : ''}`}>
                        {editing ? (
                            <Input
                                className="h-8 min-w-0 flex-1 text-xs"
                                placeholder="Observaciones (sin ensalada, sin cebolla…)"
                                value={notesValue}
                                autoFocus
                                disabled={!canEdit}
                                onChange={(e) => setNotesDraft((cur) => ({ ...cur, [item.id]: e.target.value }))}
                                onBlur={() => commitNotes(item)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitNotes(item);
                                    if (e.key === 'Escape') {
                                        setNotesDraft((cur) => {
                                            const copy = { ...cur };
                                            delete copy[item.id];
                                            return copy;
                                        });
                                    }
                                }}
                                data-testid={`${testIdPrefix}-item-notas-${item.id}`}
                            />
                        ) : null}
                        {showControls && !editing && (
                            <button
                                type="button"
                                onClick={() => setNotesDraft((cur) => ({ ...cur, [item.id]: item.notes || '' }))}
                                data-testid={`${testIdPrefix}-item-nota-${item.id}`}
                                className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                            >
                                📝 {item.notes ? 'Editar nota' : 'Nota'}
                            </button>
                        )}
                        {showControls && (
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
                        {canVoid && !draft && canEdit && voidingId !== item.id && (
                            /* Acción discreta, como el mockup: ✕ chico, no un
                               botón rojo con texto. Apagada por defecto
                               (flag `item_void` en Ajustes). */
                            <button
                                type="button"
                                onClick={() => { setVoidingId(item.id); setVoidReason(''); }}
                                aria-label={`Anular ${item.product_name}`}
                                title="Anular producto"
                                data-testid={`${testIdPrefix}-item-anular-${item.id}`}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                                <Ban className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                )}
                {voidingId === item.id && (
                    <div className="flex items-center gap-1.5" data-testid={`${testIdPrefix}-item-anular-panel-${item.id}`}>
                        <Input
                            className="h-8 min-w-0 flex-1 text-xs"
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
    };

    return (
        <div className="min-w-0 space-y-2">
            <div className="min-w-0 divide-y overflow-hidden rounded-xl border" data-testid={`${testIdPrefix}-items`}>
                {sentMeta && sentItems.length > 0 && (
                    <div className="bg-secondary/40" data-testid={`${testIdPrefix}-enviados`}>
                        {/* Cabecera del bloque enviado, como el `.sent` del mockup:
                            `#id · hh:mm` y el tag de estado del pedido UNA vez. */}
                        <div className="flex items-center justify-between gap-2 px-3 pb-0.5 pt-2 text-xs text-muted-foreground">
                            <span className="truncate" data-testid={`${testIdPrefix}-enviados-meta`}>
                                #{sentMeta.number} · {fmtTime(sentMeta.at)}
                            </span>
                            <span
                                className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-extrabold ${KITCHEN_TONE[sentTag.key] || KITCHEN_TONE.done}`}
                                data-testid={`${testIdPrefix}-enviados-estado`}
                            >
                                {sentTag.label}
                            </span>
                        </div>
                        {sentItems.map(renderItem)}
                    </div>
                )}
                {draftItems.map(renderItem)}
                {visible.length === 0 && (
                    <p className="px-3 py-3 text-center text-xs text-muted-foreground">Todavía no pidió nada.</p>
                )}
            </div>
        </div>
    );
}

/**
 * Desglose Consumido / Pagado / Pendiente de una cuenta o mesa.
 *
 * Lo usan el resumen de mesa (varias personas) y la hoja de una sola cuenta:
 * en ambos casos los testids salen del mismo `testIdPrefix`. La versión suelta
 * trae su propio borde; dentro de `TableSummary` se apoya en el borde superior.
 */
export function AccountTotals({
    testIdPrefix = 'mesa-sheet',
    consumido = 0,
    pagado = 0,
    pendiente = 0,
    className = 'space-y-0.5 rounded-xl border px-3 py-2',
}) {
    return (
        <div className={className}>
            <div className="flex items-baseline justify-between gap-2 text-sm" data-testid={`${testIdPrefix}-consumido`}>
                <span className="text-muted-foreground">Consumido</span>
                <span className="font-mono tabular-nums">{fmtMoney(consumido)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm" data-testid={`${testIdPrefix}-pagado`}>
                <span className="text-muted-foreground">Pagado</span>
                <span className="font-mono tabular-nums">{fmtMoney(pagado)}</span>
            </div>
            {/* Pendiente como el `.total` del prototipo: separador punteado y
                monto grande, que es el número que el mozo dice en voz alta. */}
            <div className="mt-0.5 flex items-baseline justify-between gap-2 border-t border-dashed pt-2.5 text-lg font-extrabold" data-testid={`${testIdPrefix}-pendiente`}>
                <span>Pendiente</span>
                <span className="font-mono tabular-nums">{fmtMoney(pendiente)}</span>
            </div>
        </div>
    );
}

/**
 * Resumen general de la mesa: una barra con icono de recibo arriba del todo.
 *
 * Muestra el total y cuántos platos hay sin necesidad de abrirla. Al desplegar,
 * cada línea se puede abrir para ver quién la pidió y moverla a otra persona:
 * así se responde "¿quién pidió el pollo sin ensalada?" y se corrige ahí mismo.
 */
export function TableSummary({
    rows = [],
    accounts = 0,
    dishes = 0,
    total = 0,
    consumido = 0,
    pagado = 0,
    pendiente = 0,
    people = [],
    canEdit = false,
    showTotals = true,
    onMoveItem,
    onOpenReceipt,
    testIdPrefix = 'mesa-sheet',
}) {
    const [open, setOpen] = useState(false);
    const [openRow, setOpenRow] = useState(null);
    const empty = rows.length === 0;

    return (
        <div className="min-w-0 rounded-xl border" data-testid={`${testIdPrefix}-resumen`}>
            <div className="flex items-center gap-1 pr-2">
                <button
                    type="button"
                    onClick={() => setOpen((cur) => !cur)}
                    aria-expanded={open}
                    data-testid={`${testIdPrefix}-resumen-toggle`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-secondary/60"
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="page-kicker truncate">Resumen de mesa</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                        {!empty && (
                            <span className="text-xs text-muted-foreground tabular-nums">{dishes} platos</span>
                        )}
                        <span className="font-mono text-sm font-semibold tabular-nums">{fmtMoney(total)}</span>
                        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                </button>
                {onOpenReceipt && !empty && (
                    <button
                        type="button"
                        onClick={() => onOpenReceipt()}
                        aria-label="Ver el recibo de la mesa"
                        title="Ver el recibo de la mesa"
                        data-testid={`${testIdPrefix}-ver-recibo`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-foreground"
                    >
                        <Printer className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            {/* Consumido/Pagado/Pendiente siempre a la vista, como el resumen del
                prototipo: el mozo los lee de reojo sin desplegar los platos.
                `showTotals={false}` evita duplicar los testids cuando el panel
                del detalle ya los muestra (diálogo "Resumen de mesa"). */}
            {showTotals && (
                <AccountTotals
                    testIdPrefix={testIdPrefix}
                    consumido={consumido}
                    pagado={pagado}
                    pendiente={pendiente}
                    className="space-y-0.5 border-t px-3 py-2"
                />
            )}
            {open && (
                <div className="border-t px-3 py-2">
                    {empty ? (
                        <p className="text-xs text-muted-foreground">La mesa todavía no pidió nada.</p>
                    ) : (
                        <ul className="space-y-0.5">
                            {rows.map((row) => {
                                const expanded = openRow === row.key;
                                return (
                                    <li key={row.key} data-testid={`${testIdPrefix}-resumen-fila-${row.product_id}${row.notes ? '-con-observacion' : ''}`}>
                                        <button
                                            type="button"
                                            onClick={() => setOpenRow(expanded ? null : row.key)}
                                            aria-expanded={expanded}
                                            data-testid={`${testIdPrefix}-resumen-abrir-${row.key}`}
                                            className="flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-secondary/60"
                                        >
                                            <span className="min-w-0 truncate">
                                                {summaryLine(row)}
                                                {accounts > 1 && peopleLabel(row) && (
                                                    <span className="ml-1 text-[11px] text-muted-foreground">— {peopleLabel(row)}</span>
                                                )}
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                                                {fmtMoney(row.subtotal)}
                                                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                            </span>
                                        </button>
                                        {expanded && (
                                            <ul className="mb-1 ml-2 border-l pl-2" data-testid={`${testIdPrefix}-resumen-detalle-${row.key}`}>
                                                {row.items.map(({ item, person, personId }) => (
                                                    <li key={item.id} className="flex flex-wrap items-center gap-2 py-0.5 text-xs">
                                                        <span className="text-muted-foreground">{item.quantity}×</span>
                                                        <span className="font-medium">{person || 'Compartido'}</span>
                                                        {item.notes && <span className="text-muted-foreground">({item.notes})</span>}
                                                        {canEdit && people.length > 1 && onMoveItem && (
                                                            <select
                                                                value=""
                                                                onChange={(e) => { if (e.target.value) onMoveItem(item, e.target.value, personId); }}
                                                                aria-label={`Mover ${item.product_name} a otra persona`}
                                                                data-testid={`${testIdPrefix}-mover-item-${item.id}`}
                                                                className="ml-auto h-7 rounded-md border border-border bg-card px-1 text-[11px]"
                                                            >
                                                                <option value="">Mover a…</option>
                                                                {people
                                                                    .filter((p) => p.label !== person)
                                                                    .map((p) => (
                                                                        <option key={p.id} value={p.id}>{p.label}</option>
                                                                    ))}
                                                            </select>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Recibo de la mesa para mostrar, imprimir o entregar: el total agrupado y
 * cuánto puso cada persona. Es la vista de "cuenta", no la de tomar pedido.
 */
export function TableReceipt({ table, rows = [], accounts = [], total = 0, pending = 0, testIdPrefix = 'mesa-sheet' }) {
    return (
        <div className="min-w-0 space-y-3 rounded-xl border p-3" data-testid={`${testIdPrefix}-recibo`}>
            <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-semibold">Mesa {table?.number}</span>
                <span className="text-xs text-muted-foreground">{table?.area}</span>
            </div>
            <div className="space-y-0.5">
                {rows.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay productos.</p>}
                {rows.map((row) => (
                    <div key={row.key} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{summaryLine(row)}</span>
                        <span className="shrink-0 font-mono tabular-nums">{fmtMoney(row.subtotal)}</span>
                    </div>
                ))}
            </div>
            {accounts.length > 0 && (
                <div className="space-y-0.5 border-t pt-2">
                    <span className="page-kicker">Por persona</span>
                    {accounts.map((account) => (
                        <div key={account.id} className="flex items-baseline justify-between gap-2 text-sm" data-testid={`${testIdPrefix}-recibo-persona-${account.id}`}>
                            <span className="min-w-0 truncate">{account.label}</span>
                            <span className="shrink-0 font-mono tabular-nums">{fmtMoney(account.total)}</span>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-2 font-display text-lg font-bold">
                <span>Total</span>
                <span className="font-mono tabular-nums">{fmtMoney(total)}</span>
            </div>
            {pending > 0 && (
                <p className="text-[11px] text-muted-foreground" data-testid={`${testIdPrefix}-recibo-pendientes`}>
                    Hay {pending} producto{pending === 1 ? '' : 's'} por enviar que ya están contados en el total.
                </p>
            )}
            <Button variant="outline" className="w-full" onClick={() => window.print()} data-testid={`${testIdPrefix}-recibo-imprimir`}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
        </div>
    );
}
