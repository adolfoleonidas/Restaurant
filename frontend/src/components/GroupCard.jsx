import React from 'react';
import { Ban, Bell, Check, Clock, Plus, Receipt, Unlink, UtensilsCrossed } from 'lucide-react';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import { countOf } from '@/lib/format';
import { usePendingActions } from '@/contexts/PendingActionsContext';

/**
 * GroupCard — the single "big table" shown when two or more tables are joined.
 *
 * Mirrors the reference prototype: one card spanning two grid columns, with the
 * anchor (main) table large and the other members as mini-badges. Each member
 * still keeps its own account, so the card prints the combined balance plus a
 * "N cuentas" badge instead of pretending there is a single bill.
 *
 * Inline actions are only offered when unambiguous: exactly one "cuenta"
 * account for Cobrar, or exactly one "listo" order for Entregar. Everything
 * else lives in the sheet, which lists members and accounts.
 *
 * Two floor operations touch this card directly:
 *   * "Separar" — dissolving a group used to hide three taps deep inside the
 *     sheet; the card that shows the group is where the mozo looks for it. It is
 *     confirmed, because it touches every member.
 *   * Picking — while joining tables, a group is picked **as a whole** (the mozo
 *     means the party, not a chair) and that pick is what turns "unir mesas" into
 *     "add this table to that group". Before, the card just dimmed and stopped
 *     answering taps while its member badges still opened the sheet.
 */

// Pressed = an instant darker tone plus an inner ring; the button never moves
// or scales (its colour is set inline, so a background class could not win).
const ACTION_BASE = 'touch-target-coarse min-h-11 sm:min-h-9 rounded-lg text-sm font-semibold active:brightness-90 active:ring-2 active:ring-inset active:ring-black/20';

export default function GroupCard({
    unit, canServe, canCharge, canSeparate, selectMode, picked = false, pickIssue = null,
    separating = false, onOpen, onOpenMember, onDeliver, onCharge, onSelect, onSeparate,
}) {
    const pendingActions = usePendingActions();
    const { floor, anchor, accounts, amount, elapsed, minutes, urgency, isLate, members } = unit;
    const s = FLOOR_STYLE[floor.key];
    const needsAttention = ['listo', 'cuenta', 'atencion'].includes(floor.key);
    // Capacidad del grupo: la suma de sus mesas, y solo cuando todas la
    // informan. Una mesa sin capacidad no se inventa: la línea no aparece.
    const memberSeats = members.map((m) => Number(m.table.capacity ?? m.table.seats ?? 0) || 0);
    const seats = memberSeats.length > 0 && memberSeats.every((n) => n > 0)
        ? memberSeats.reduce((sum, n) => sum + n, 0)
        : null;

    const cobrable = canCharge ? members.filter((m) => m.floor.key === 'cuenta' && m.serviceOrder) : [];
    const entregable = canServe ? members.filter((m) => m.floor.key === 'listo' && m.serviceOrder) : [];
    const showCobrar = cobrable.length === 1;
    const showEntregar = entregable.length === 1;
    const showSeparate = Boolean(canSeparate) && !selectMode;
    const showActions = showCobrar || showEntregar || showSeparate;
    const blocked = selectMode && Boolean(pickIssue);
    // Cuatro lados escritos uno por uno, no el atajo `borderWidth`/`borderColor`:
    // mezclar el atajo con `borderLeftWidth` (el acento del grupo) hace que React
    // avise en cada repintado y deja el borde a merced del orden de las reglas.
    const borderW = needsAttention || picked ? 3 : 2;
    const borderC = picked ? 'hsl(var(--primary))' : (needsAttention ? s.dot : s.border);

    return (
        <div
            data-testid={`mesa-grupo-${anchor.table.number}`}
            data-floor-state={floor.key}
            data-grouped="true"
            data-selected={picked ? 'true' : undefined}
            data-pick={selectMode ? (blocked ? 'blocked' : picked ? 'picked' : 'open') : undefined}
            aria-disabled={blocked ? 'true' : undefined}
            onClick={() => {
                if (selectMode) { if (!blocked) onSelect(anchor.table); return; }
                onOpen();
            }}
            className={`relative col-span-2 rounded-xl border-2 flex flex-col text-left ${blocked ? 'cursor-not-allowed' : 'cursor-pointer'} ${isLate ? 'floor-late' : ''}`}
            style={{
                background: s.bg,
                color: s.fg,
                // Un solo contorno: el aviso de atención engrosa el mismo borde en
                // vez de sumar un `ring` que se veía como un segundo borde.
                borderStyle: blocked ? 'dashed' : 'solid',
                borderTopWidth: borderW,
                borderRightWidth: borderW,
                borderBottomWidth: borderW,
                borderLeftWidth: 6,
                borderTopColor: borderC,
                borderRightColor: borderC,
                borderBottomColor: borderC,
                borderLeftColor: '#7C6BC4',
            }}
        >
            <div className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1">
                <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1 flex-wrap">
                        <div className="font-display text-3xl sm:text-4xl font-bold leading-none">{anchor.table.number}</div>
                        {members.filter((m) => m.table.id !== anchor.table.id).map((m) => (
                            <button
                                key={m.table.id}
                                type="button"
                                data-testid={`mesa-grupo-miembro-${m.table.number}`}
                                aria-label={selectMode
                                    ? `Elegir el grupo de mesas, que incluye la Mesa ${m.table.number}`
                                    : `Abrir Mesa ${m.table.number}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // Al elegir, el miembro no abre su hoja: el
                                    // grupo entero es lo que se está eligiendo.
                                    if (selectMode) { if (!blocked) onSelect(anchor.table); return; }
                                    onOpenMember(m.table);
                                }}
                                className="min-h-touch min-w-touch px-1 grid place-items-center rounded-md bg-black/5 text-sm font-bold leading-none cursor-pointer"
                            >
                                {m.table.number}
                            </button>
                        ))}
                    </div>
                    {selectMode ? (
                        <span
                            data-testid={`mesa-grupo-elegir-${anchor.table.number}`}
                            className={`shrink-0 inline-flex items-center gap-1 rounded-md border-2 px-1.5 py-0.5 text-xs font-semibold ${picked ? 'bg-primary border-primary text-primary-foreground' : blocked ? 'border-dashed bg-card text-muted-foreground' : 'bg-card border-border'}`}
                        >
                            {blocked
                                ? <><Ban className="h-3.5 w-3.5" aria-hidden="true" />No</>
                                : picked
                                    ? <><Check className="h-3.5 w-3.5" aria-hidden="true" />Elegido</>
                                    : <><Plus className="h-3.5 w-3.5" aria-hidden="true" />Elegir</>}
                        </span>
                    ) : needsAttention && (
                        <span className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center" style={{ background: s.dot }} aria-label="Requiere atención">
                            <Bell className="h-3.5 w-3.5 text-white" />
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                    <span className="text-sm font-semibold">{s.label}</span>
                    {/* Late is a word, not only a colour: the border and ring of
                        `.floor-late` are static, and this label says why. */}
                    {isLate && (
                        <span
                            data-testid="mesa-grupo-atrasada"
                            className="text-xs font-bold rounded-full px-2 py-0.5 text-white"
                            style={{ background: '#B91C1C' }}
                        >
                            Atrasada
                        </span>
                    )}
                    {accounts > 1 && (
                        <span data-testid="mesa-grupo-cuentas" className="text-xs font-medium rounded-full px-2 py-0.5 border" style={{ background: FLOOR_STYLE.cuenta.bg, color: FLOOR_STYLE.cuenta.fg, borderColor: FLOOR_STYLE.cuenta.border }}>
                            {countOf(accounts, 'cuenta', 'cuentas')}
                        </span>
                    )}
                </div>
                {blocked && (
                    <div className="text-xs font-medium text-destructive" data-testid={`mesa-grupo-motivo-${anchor.table.number}`}>
                        {pickIssue}
                    </div>
                )}
                {seats != null && (
                    <div className="text-xs text-muted-foreground" data-testid="mesa-grupo-asientos">
                        {seats} asientos
                    </div>
                )}
                {minutes > 0 && !['libre', 'pagada', 'inactiva'].includes(floor.key) && (
                    <div className={`flex items-center gap-1 text-xs ${urgency ? '' : 'opacity-75'}`}>
                        <Clock className="h-3 w-3" />
                        <span style={urgency === 'bad' ? { color: '#B91C1C', fontWeight: 700 } : urgency === 'warn' ? { color: '#B45309', fontWeight: 600 } : undefined}>
                            Hace {elapsed}
                        </span>
                    </div>
                )}
                {amount && (
                    <div className="mt-auto text-xs font-mono font-semibold tabular-nums opacity-80">
                        <div data-testid="mesa-grupo-total">{amount}</div>
                    </div>
                )}
            </div>
            {showActions && (
                // La tarjeta de grupo ocupa dos columnas: sus acciones caben en
                // una fila en móvil y la tarjeta no crece. En escritorio se
                // conserva la columna de siempre.
                <div className="px-3 pb-3 sm:px-4 sm:pb-4 flex gap-1.5 sm:flex-col">
                    {showEntregar && (
                        <button type="button" data-testid="mesa-grupo-entregar" disabled={pendingActions.has(`deliver:${entregable[0].serviceOrder.id}`)} aria-busy={pendingActions.has(`deliver:${entregable[0].serviceOrder.id}`) ? 'true' : undefined} className={`${ACTION_BASE} grow text-white`} style={{ background: FLOOR_STYLE.listo.dot }} onClick={(e) => { e.stopPropagation(); onDeliver(entregable[0].serviceOrder.id); }}>
                            <UtensilsCrossed className="h-3.5 w-3.5 inline mr-1" />{pendingActions.has(`deliver:${entregable[0].serviceOrder.id}`) ? 'Entregando…' : 'Entregar'}
                        </button>
                    )}
                    {showCobrar && (
                        <button type="button" data-testid="mesa-grupo-cobrar" className={`${ACTION_BASE} grow text-white`} style={{ background: FLOOR_STYLE.cuenta.dot }} onClick={(e) => { e.stopPropagation(); onCharge(cobrable[0].serviceOrder); }}>
                            <Receipt className="h-3.5 w-3.5 inline mr-1" />Cobrar
                        </button>
                    )}
                    {showSeparate && (
                        <button type="button" data-testid={`mesa-grupo-separar-${anchor.table.number}`} disabled={separating} aria-busy={separating ? 'true' : undefined} className={`${ACTION_BASE} grow border`} style={{ borderColor: s.border }} onClick={(e) => { e.stopPropagation(); onSeparate(); }}>
                            <Unlink className="h-3.5 w-3.5 inline mr-1" />{separating ? 'Separando…' : 'Separar'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
