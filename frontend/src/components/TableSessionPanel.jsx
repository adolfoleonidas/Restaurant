import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import { Plus } from 'lucide-react';

/**
 * Vista agrupada de la mesa.
 *
 * Internamente cada envío es un pedido aparte con su propio pago, pero el
 * cliente ve la mesa completa: qué pidió en cada envío, qué ya pagó, qué falta
 * y cuánto lleva. Sirve tanto al escanear el QR como al abrir el seguimiento de
 * un pedido, donde la mesa se resuelve por el propio pedido.
 */
const PAYMENT_LABELS_BY_STATE = {
    pendiente: 'Pendiente de pago',
    reportado: 'Comprobante en revisión',
    confirmado: 'Pagado',
    rechazado: 'Pago rechazado',
    expirado: 'Pago vencido',
    reembolsado: 'Reembolsado',
    no_requerido: 'Se paga al final',
};

function orderState(order) {
    if (order.paid) return { label: 'Pagado', tone: 'text-emerald-700 dark:text-emerald-300' };
    const info = PAYMENT_LABELS_BY_STATE[order.payment_state || 'pendiente'] || 'Pendiente de pago';
    const tone = order.payment_state === 'rechazado' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300';
    return { label: info, tone };
}

export function TableSessionPanel({ table, session, onOrderMore, currentOrderId = null, testIdPrefix = 'table-session' }) {
    if (!table || !session) return null;
    const orders = session.orders || [];
    const hasPending = Number(session.total_pending) > 0;
    return (
        <section className="space-y-3" data-testid={`${testIdPrefix}-panel`}>
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <div className="page-kicker">Tus pedidos</div>
                    <h2 className="font-display text-2xl font-bold">
                        Mesa {table.number}{table.area ? ` · ${table.area}` : ''}
                    </h2>
                </div>
                <div className="text-right text-sm">
                    <div data-testid={`${testIdPrefix}-paid`}>Total pagado: <span className="font-semibold tabular-nums">{fmtMoney(session.total_paid)}</span></div>
                    {hasPending && (
                        <div className="text-amber-700 dark:text-amber-300" data-testid={`${testIdPrefix}-pending`}>
                            Pendiente: <span className="font-semibold tabular-nums">{fmtMoney(session.total_pending)}</span>
                        </div>
                    )}
                </div>
            </div>

            {orders.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    Todavía no hay pedidos en esta mesa. Elegí algo de la carta para empezar.
                </p>
            ) : (
                <ul className="space-y-2">
                    {orders.map((order) => {
                        const state = orderState(order);
                        const waiting = order.acceptance_status === 'pendiente';
                        const isCurrent = currentOrderId && order.id === currentOrderId;
                        return (
                            <li
                                key={order.id}
                                className={`rounded-xl border p-3 ${isCurrent ? 'border-primary ring-1 ring-primary/30' : ''}`}
                                data-testid={`${testIdPrefix}-order-${order.order_number}`}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold">
                                        Pedido #{order.order_number}
                                        {isCurrent && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Estás viendo este</span>}
                                    </div>
                                    <div className={`text-sm font-medium ${state.tone}`} data-testid={`${testIdPrefix}-order-${order.order_number}-payment`}>
                                        {order.paid ? `Pagado — ${fmtMoney(order.total)}` : `${state.label} — ${fmtMoney(order.total)}`}
                                    </div>
                                </div>

                                {(order.items || []).length > 0 && (
                                    <ul className="mt-2 space-y-0.5 text-sm" data-testid={`${testIdPrefix}-order-${order.order_number}-items`}>
                                        {order.items.map((item, index) => (
                                            <li key={`${order.id}-${index}`} className="flex gap-2">
                                                <span className="tabular-nums text-muted-foreground">{item.quantity}×</span>
                                                <span className="min-w-0">
                                                    {item.name}
                                                    {item.notes ? <span className="text-xs italic text-muted-foreground"> · {item.notes}</span> : null}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span>{order.item_count} {order.item_count === 1 ? 'plato' : 'platos'}</span>
                                    <span>{waiting ? 'Esperando confirmación de pago' : (ORDER_STATUS_LABELS[order.status] || order.status)}</span>
                                    {order.tracking_code && (
                                        <Link to={`/pedido/${order.tracking_code}`} className="underline hover:text-foreground">
                                            Ver seguimiento
                                        </Link>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="h-12 flex-1" onClick={onOrderMore} data-testid={`${testIdPrefix}-order-more`}>
                    <Plus className="h-4 w-4 mr-2" /> Pedir algo más
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                Cada envío es un pedido aparte con su propio importe: si alguien pide algo más, se cobra y se prepara por separado.
            </p>
        </section>
    );
}

export default TableSessionPanel;
