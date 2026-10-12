import React from 'react';
import { Bell, Check, CheckCheck, Clock, Link2, Plus, Receipt, UtensilsCrossed } from 'lucide-react';
import AttentionReference from '@/components/AttentionReference';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import { elapsedMinutes, fmtElapsed, fmtMoney } from '@/lib/format';
import { canCloseAttention } from '@/lib/attentionClose';

/**
 * MesaCard — one table of the Salón floor grid.
 *
 * The card must not say the same thing twice, so:
 * - the state colour + label already carry "Libre / Ocupada / Cuenta"; the
 *   "Cuenta solicitada" badge only shows up when it adds a fact the state does
 *   not (the bill was asked while the food is still in progress);
 * - the amount is printed once: the balance, plus the ticket total only when a
 *   partial payment makes the two numbers different;
 * - every footer button is the same `CardAction`, so its classes, icon sizing
 *   and `stopPropagation` wiring are written once for all four actions.
 *
 * It also carries the two floor operations of "unir mesas": the group badge (with
 * the number of bills the group holds) and the selection state used while the
 * waiter picks tables to join.
 *
 * Kept `data-testid` contracts: `mesa-card-*`, `mesa-card-deliver-*`,
 * `mesa-card-cobrar-*`, `mesa-card-pedir-*`, `servicio-cerrar-*`,
 * `data-floor-state` and `aria-label="Requiere atencion"`.
 */

const ACTION_BASE = 'touch-target-coarse min-h-11 sm:min-h-9 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]';

// El fondo de los botones sólidos es el tono oscuro del estado (`fg`), no el
// punto de color (`dot`): blanco sobre `dot` da 3,67:1 (Listo) y 2,95:1
// (Cuenta) y no llega a AA. Es el mismo arreglo P1-7 de docs/ui-ux-audit.md,
// que los componentes nuevos de tarjeta habían reintroducido. Cada estado
// conserva su identidad porque cada `fg` es un tono distinto.
const ACTION_VARIANT = {
    solid: { className: 'text-white', style: ({ color }) => ({ background: color }) },
    soft: { className: '', style: ({ s }) => ({ background: s.border }) },
    outline: { className: 'border', style: ({ s }) => ({ borderColor: s.border }) },
};

function CardAction({ label, icon: Icon, testId, variant, color, s, disabled = false, onClick }) {
    const { className, style } = ACTION_VARIANT[variant];
    return (
        <button
            type="button"
            data-testid={testId}
            disabled={disabled}
            className={`${ACTION_BASE} ${className}`}
            style={style({ color, s })}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
            {Icon && <Icon className="h-3.5 w-3.5 inline mr-1" />}{label}
        </button>
    );
}

export default function MesaCard({
    item,
    branchNames = null,
    canServe,
    canCharge,
    canClose,
    canTake,
    closing = null,
    selectMode = false,
    picked = false,
    onSelect,
    onOpen,
    onDeliver,
    onCharge,
    onCloseAttention,
    onTake,
}) {
    const { table: t, floor, displayOrder, serviceOrder, ready, due, billRequested, showVisitaActiva, group, groupBadge, groupNumbers } = item;
    const s = FLOOR_STYLE[floor.key];
    // Mismo campo que la cabecera del sheet (Capacidad N personas); `seats` es
    // el nombre del prototipo y queda como respaldo para datos antiguos.
    const seats = Number(t.capacity ?? t.seats ?? 0) || 0;
    const needsAttention = ['listo', 'cuenta', 'atencion'].includes(floor.key);
    const elapsed = displayOrder?.created_at ? fmtElapsed(displayOrder.created_at) : null;
    // Urgencia por tiempo de permanencia: ámbar a partir de 30 min, rojo a los 45.
    const minutes = elapsedMinutes(displayOrder?.created_at || serviceOrder?.created_at || null);
    const urgency = minutes >= 45 ? 'bad' : minutes >= 30 ? 'warn' : null;
    const isLate = floor.key === 'cuenta' && urgency === 'bad';
    // Miembros del grupo además de la mesa que muestra esta tarjeta.
    const groupOthers = (groupNumbers || []).filter((n) => Number(n) !== Number(t.number));
    const closeable = canClose && canCloseAttention(t, serviceOrder);
    const showDeliver = canServe && (floor.key === 'listo' || ready > 0) && Boolean(serviceOrder);
    const showCobrar = canCharge && floor.key === 'cuenta' && Boolean(serviceOrder);
    const takeable = canTake && (floor.key === 'libre' || floor.key === 'sentados');
    // The state label is already "Cuenta" in the cuenta state: the badge would
    // only repeat it.
    const showBillBadge = billRequested && floor.key !== 'cuenta';

    // The order that owns the balance is the one the card prices: the active
    // service order, falling back to the displayed order (a paid visit still on
    // the table has no service order left).
    const priced = serviceOrder || displayOrder || null;
    const total = priced?.total != null ? Number(priced.total) : null;
    const paid = Number(priced?.amount_paid || 0);
    const amount = due > 0
        ? {
            primary: `Debe ${fmtMoney(due)}`,
            // Only a partial payment makes the ticket total differ from the
            // balance, so that is the one case where a second number is news.
            secondary: paid > 0 && total != null ? total : null,
        }
        : (total != null ? { primary: fmtMoney(total), secondary: null } : null);

    const actions = [];
    if (showDeliver) {
        actions.push({
            key: 'entregar', label: 'Entregar', icon: UtensilsCrossed, variant: 'solid', color: FLOOR_STYLE.listo.fg,
            testId: `mesa-card-deliver-${t.number}`, onClick: () => onDeliver(serviceOrder.id),
        });
    }
    if (showCobrar) {
        actions.push({
            key: 'cobrar', label: 'Cobrar', icon: Receipt, variant: 'solid', color: FLOOR_STYLE.cuenta.fg,
            testId: `mesa-card-cobrar-${t.number}`, onClick: () => onCharge(serviceOrder),
        });
    }
    if (takeable) {
        actions.push({
            key: 'pedir', label: 'Tomar pedido', icon: floor.key === 'libre' ? Plus : null, variant: 'soft',
            testId: `mesa-card-pedir-${t.number}`, onClick: () => onTake(t),
        });
    }
    if (closeable) {
        const busy = closing === serviceOrder.id;
        actions.push({
            key: 'cerrar', label: busy ? 'Cerrando…' : 'Finalizar mesa', icon: CheckCheck, variant: 'outline',
            disabled: busy, testId: `servicio-cerrar-${t.number}`, onClick: () => onCloseAttention(serviceOrder),
        });
    }

    return (
        <div
            data-testid={`mesa-card-${t.number}`}
            data-floor-state={floor.key}
            data-selected={picked ? 'true' : undefined}
            data-grouped={group ? 'true' : undefined}
            onClick={() => (selectMode ? onSelect(t) : onOpen(t))}
            className={`relative rounded-xl border-2 flex flex-col text-left transition-transform cursor-pointer ${isLate ? 'floor-late' : ''}`}
            style={{
                background: s.bg,
                // Inherited by every child: no child repeats `color: s.fg`.
                color: s.fg,
                // Un solo contorno por tarjeta. Antes, el aviso de atención y la
                // selección sumaban un `ring`, que dibujaba una segunda línea
                // separada del borde (y con el `ring-offset` dejaba un hueco): en
                // pantalla se veían dos bordes. El énfasis ahora es el mismo
                // borde, más grueso y del color del estado.
                borderWidth: needsAttention ? 3 : 2,
                borderColor: needsAttention ? s.dot : (picked ? 'hsl(var(--primary))' : s.border),
                // Una mesa unida conserva un acento compartido para leerse como grupo.
                ...(group ? { borderLeftWidth: 6, borderLeftColor: '#7C6BC4' } : {}),
            }}
        >
            <div className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1 active:scale-[0.99] transition-transform">
                <div className="flex items-start justify-between gap-1">
                    {groupOthers.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                            <div className="font-display text-3xl sm:text-4xl font-bold leading-none">{t.number}</div>
                            {groupOthers.map((n) => (
                                <span key={n} className="h-6 min-w-6 px-1 grid place-items-center rounded-md bg-black/5 text-sm font-bold leading-none">
                                    {n}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <div className="font-display text-3xl sm:text-4xl font-bold leading-none">{t.number}</div>
                    )}
                    {selectMode && (
                        <span
                            aria-label={picked ? 'Mesa elegida' : 'Elegir mesa'}
                            className={`absolute top-3 right-3 h-6 w-6 rounded-md border-2 grid place-items-center ${picked ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border'}`}
                        >
                            {picked && <Check className="h-4 w-4" />}
                        </span>
                    )}
                    {!selectMode && needsAttention && (
                        <span className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center" style={{ background: s.dot }} role="img" aria-label="Requiere atencion">
                            <Bell className="h-3.5 w-3.5 text-white" />
                        </span>
                    )}
                </div>
                {seats > 0 && (
                    <div className="text-xs text-muted-foreground" data-testid={`mesa-card-asientos-${t.number}`}>
                        {seats} asientos
                    </div>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                    <span className="text-sm font-semibold">{s.label}</span>
                    {showBillBadge && (
                        <span
                            className="text-xs font-medium rounded-full px-2 py-0.5 border"
                            style={{ background: FLOOR_STYLE.cuenta.bg, color: FLOOR_STYLE.cuenta.fg, borderColor: FLOOR_STYLE.cuenta.border }}
                        >
                            Cuenta solicitada
                        </span>
                    )}
                </div>
                {groupBadge && (
                    <div
                        className="flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5 self-start max-w-full"
                        style={{ background: '#F3F0FF', color: '#3B2A66', border: '1px solid #D9D2F0' }}
                        data-testid={`mesa-card-grupo-${t.number}`}
                    >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                            {groupBadge.label}
                            {groupBadge.accounts > 1 ? ` · ${groupBadge.accounts} cuentas` : ''}
                        </span>
                    </div>
                )}
                {elapsed && !['libre', 'pagada', 'inactiva'].includes(floor.key) && (
                    /* Sin opacity: sobre los fondos suaves de estado el tiempo
                       quedaba en 3,94:1 (por debajo de AA). El token apagado da
                       la misma jerarquía sin perder contraste; los colores de
                       urgencia van en línea y ya cumplen. */
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span style={urgency === 'bad' ? { color: '#B91C1C', fontWeight: 700 } : urgency === 'warn' ? { color: '#B45309', fontWeight: 600 } : undefined}>
                            Hace {elapsed}
                        </span>
                    </div>
                )}
                {/* Sin opacity: sobre los fondos suaves de estado el texto
                    quedaba en 4,08:1 (por debajo de AA). El token de color
                    apagado ya da la jerarquía sin perder contraste. */}
                {showVisitaActiva && <div className="text-xs text-muted-foreground">Visita activa</div>}
                {displayOrder && <AttentionReference order={displayOrder} branchNames={branchNames} />}
                {amount && (
                    <div className="mt-auto text-xs font-mono font-semibold tabular-nums">
                        <div>{amount.primary}</div>
                        {amount.secondary != null && (
                            <div className="text-muted-foreground">Total {fmtMoney(amount.secondary)}</div>
                        )}
                    </div>
                )}
            </div>
            {!selectMode && actions.length > 0 && (
                <div className="px-3 pb-3 sm:px-4 sm:pb-4 flex flex-col gap-1.5">
                    {actions.map(({ key, ...action }) => <CardAction key={key} s={s} {...action} />)}
                </div>
            )}
        </div>
    );
}
