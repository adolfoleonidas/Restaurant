import React, { useMemo } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fmtElapsed, elapsedMinutes, fmtTime, ORDER_TYPE_LABELS } from '@/lib/format';
import { ChefHat, Bell, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';

const COLUMNS = [
    { key: 'nuevos', label: 'Llegan', statuses: ['enviado_cocina'] },
    { key: 'en_prep', label: 'Al fuego', statuses: ['en_preparacion'] },
    { key: 'listos', label: 'Listos', statuses: ['listo'] },
];

const timerClasses = (m) => {
    if (m < 8) return 'bg-secondary text-foreground';
    if (m < 15) return 'bg-primary/20 text-primary';
    return 'bg-accent/20 text-accent';
};

const KitchenCard = ({ order, onAccept, onReady, onDeliver, onRevert, role }) => {
    const m = elapsedMinutes(order.sent_to_kitchen_at || order.created_at);
    return (
        <Card data-testid={`cocina-ticket-${order.order_number}`} className="rounded-sm">
            <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="font-mono text-2xl font-bold leading-tight text-primary">#{order.order_number}</div>
                        <div className="text-xs text-muted-foreground">
                            <span className="page-kicker mr-1">{order.source === 'public' ? 'Carta web' : 'Salón'}</span>
                            {order.table_id ? (order.table_number || 'Mesa') : ORDER_TYPE_LABELS[order.order_type] || 'Para llevar'}
                            {' · '}{fmtTime(order.sent_to_kitchen_at || order.created_at)}
                        </div>
                        {order.customer_name && (
                            <div className="text-sm mt-1">
                                {order.customer_name}
                                {order.customer_phone && (
                                    <span className="text-muted-foreground"> · <Phone className="h-3 w-3 inline" /> {order.customer_phone}</span>
                                )}
                            </div>
                        )}
                    </div>
                    <span className={`px-3 py-1 rounded-sm text-sm font-mono font-semibold tabular-nums ${timerClasses(m)}`}>{fmtElapsed(order.sent_to_kitchen_at || order.created_at)}</span>
                </div>
                <div className="mt-3 space-y-1.5">
                    {(order.items || []).map((it) => (
                        <div key={it.id} className="flex items-start gap-2 text-base">
                            <span className="inline-flex min-w-[2rem] justify-center rounded-sm bg-primary text-primary-foreground font-mono font-semibold px-2 py-0.5">{it.quantity}×</span>
                            <div className="flex-1">
                                <div className="font-display italic">{it.product_name}{it.is_combo ? ' · combo' : ''}</div>
                                {it.is_combo && (it.combo_components || []).map((c) => (
                                    <div key={c.product_id} className="text-xs text-muted-foreground">{c.quantity}× {c.product_name}</div>
                                ))}
                                {it.notes && <div className="text-xs italic text-muted-foreground">“{it.notes}”</div>}
                            </div>
                        </div>
                    ))}
                </div>
                {order.notes && (
                    <div className="mt-3 rounded-sm border border-primary/30 bg-primary/10 p-2.5 text-sm text-primary">
                        <Bell className="h-4 w-4 inline mr-1" /> {order.notes}
                    </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                    {order.status === 'enviado_cocina' && (
                        <Button onClick={() => onAccept(order)} className="col-span-2 h-12 text-base rounded-sm" data-testid={`cocina-ticket-${order.order_number}-accept`}>Aceptar</Button>
                    )}
                    {order.status === 'en_preparacion' && (
                        <Button onClick={() => onReady(order)} className="col-span-2 h-12 text-base rounded-sm" data-testid={`cocina-ticket-${order.order_number}-ready`}>Marcar listo</Button>
                    )}
                    {order.status === 'listo' && role === 'mozo' && (
                        <Button onClick={() => onDeliver(order)} className="col-span-2 h-12 text-base rounded-sm" data-testid={`cocina-ticket-${order.order_number}-deliver`}>Entregado</Button>
                    )}
                    {order.status === 'listo' && role !== 'mozo' && (
                        <Button variant="outline" disabled className="col-span-2 h-12 text-base rounded-sm">Esperando entrega</Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default function Cocina() {
    const { user } = useAuth();
    const { generation } = useNotify();
    const { data: orders, refetch } = usePolling(
        () => api.get('/orders/kitchen').then((r) => r.data),
        12000,
        [generation]
    );
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 20000, [generation]);

    const enriched = useMemo(() => {
        const tableMap = Object.fromEntries((tables || []).map((t) => [t.id, t]));
        return (orders || []).map((o) => ({ ...o, table_number: tableMap[o.table_id]?.name || (o.table_id ? '—' : 'P/llevar') }));
    }, [orders, tables]);

    const columns = useMemo(() => {
        return COLUMNS.map((c) => ({
            ...c,
            orders: enriched.filter((o) => c.statuses.includes(o.status)),
        }));
    }, [enriched]);

    const changeStatus = async (order, status) => {
        try {
            await api.post(`/orders/${order.id}/status`, { status });
            toast.success(`Pedido #${order.order_number} actualizado`);
            await refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al actualizar');
        }
    };

    return (
        <div className="space-y-4" data-testid="cocina-root">
            <div className="flex items-center justify-between">
                <div>
                    <p className="page-kicker mb-1">Pase</p>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><ChefHat className="h-6 w-6 text-primary" /> Cocina</h1>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2"><span className="pulse-dot" /> Cada 3s</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {columns.map((col) => (
                    <div key={col.key} className="rounded-sm border border-border bg-card/50 p-3 md:p-4" data-testid={`cocina-columna-${col.key}`}>
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="font-display text-lg font-semibold">{col.label}</h2>
                            <span className="text-sm text-muted-foreground tabular-nums">{col.orders.length}</span>
                        </div>
                        <div className="space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto">
                            {col.orders.length === 0 ? (
                                <div className="text-center text-sm text-muted-foreground py-10">Sin pedidos</div>
                            ) : col.orders.map((o) => (
                                <KitchenCard
                                    key={o.id}
                                    order={o}
                                    role={user.role}
                                    onAccept={(ord) => changeStatus(ord, 'en_preparacion')}
                                    onReady={(ord) => changeStatus(ord, 'listo')}
                                    onDeliver={(ord) => changeStatus(ord, 'entregado')}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
