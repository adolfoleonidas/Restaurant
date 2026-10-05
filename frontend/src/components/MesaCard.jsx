import React from 'react';
import { Bell, CheckCheck, Clock, Link2, Plus, Receipt, UtensilsCrossed } from 'lucide-react';
import AttentionReference from '@/components/AttentionReference';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import { fmtElapsed, fmtMoney } from '@/lib/format';
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

const ACTION_BASE = 'h-9 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]';

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
    const { table: t, floor, displayOrder, serviceOrder, ready, due, billRequested, showVisitaActiva, group, groupBadge } = item;
    const s = FLOOR_STYLE[floor.key];
    const needsAttention = ['listo', 'cuenta', 'atencion'].includes(floor.key);
    const elapsed = displayOrder?.created_at ? fmtElapsed(displayOrder.created_at) : null;
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
            key: 'entregar', label: 'Entregar', icon: UtensilsCrossed, variant: 'solid', color: FLOOR_STYLE.listo.dot,
            testId: `mesa-card-deliver-${t.number}`, onClick: () => onDeliver(serviceOrder.id),
        });
    }
    if (showCobrar) {
        actions.push({
            key: 'cobrar', label: 'Cobrar', icon: Receipt, variant: 'solid', color: FLOOR_STYLE.cuenta.dot,
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
            className={`rounded-xl border-2 flex flex-col text-left transition-transform cursor-pointer ${needsAttention ? 'ring-2 ring-offset-1' : ''} ${picked ? 'ring-4 ring-primary' : ''}`}
            style={{
                background: s.bg,
                // Inherited by every child: no child repeats `color: s.fg`.
                color: s.fg,
                borderColor: needsAttention ? s.dot : s.border,
                // A joined table keeps a shared accent so the party reads as one.
                ...(group ? { borderLeftWidth: 6, borderLeftColor: '#7C6BC4' } : {}),
                ...(needsAttention ? { ['--tw-ring-color']: s.dot } : {}),
            }}
        >
            <div className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1 active:scale-[0.99] transition-transform">
                <div className="flex items-start justify-between gap-1">
                    <div className="font-display text-3xl sm:text-4xl font-bold leading-none">{t.number}</div>
                    {picked && (
                        <span className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-primary text-primary-foreground" aria-label="Mesa elegida">
                            <Link2 className="h-3.5 w-3.5" />
                        </span>
                    )}
                    {!picked && needsAttention && (
                        <span className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center" style={{ background: s.dot }} aria-label="Requiere atencion">
                            <Bell className="h-3.5 w-3.5 text-white" />
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                    <span className="text-sm font-semibold">{s.label}</span>
                    {showBillBadge && (
                        <span
                            className="text-[10px] font-medium rounded-full px-2 py-0.5 border"
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
                    <div className="flex items-center gap-1 text-xs opacity-75">
                        <Clock className="h-3 w-3" />
                        <span>Hace {elapsed}</span>
                    </div>
                )}
                {showVisitaActiva && <div className="text-xs opacity-80">Visita activa</div>}
                {displayOrder && <AttentionReference order={displayOrder} branchNames={branchNames} />}
                {amount && (
                    <div className="mt-auto text-xs font-mono font-semibold tabular-nums opacity-80">
                        <div>{amount.primary}</div>
                        {amount.secondary != null && (
                            <div className="opacity-80">Total {fmtMoney(amount.secondary)}</div>
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
