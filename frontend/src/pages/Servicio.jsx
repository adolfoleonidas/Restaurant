import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { useNotify } from '@/contexts/NotifyContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasFn } from '@/lib/functions';
import { activeAttentionOrder, canCloseAttention } from '@/lib/attentionClose';
import { partitionPriorPickupOrders } from '@/lib/serviceDay';
import { ChefHat, CheckCheck, Plus } from 'lucide-react';
import { toast } from 'sonner';
import AttentionReference from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function remaining(order) {
    const total = Number(order.total || 0);
    const paid = Number(order.amount_paid || 0);
    return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export default function Servicio() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const { generation } = useNotify();
    const canCharge = hasFn(user, 'cobro', 'administracion');
    const canServe = hasFn(user, 'preparacion', 'atencion', 'administracion');
    const canClose = ['admin', 'mozo', 'cajero'].includes(user?.role);
    const canTakeOrder = ['admin', 'mozo'].includes(user?.role);
    const [delivering, setDelivering] = useState(null);
    const [closing, setClosing] = useState(null);
    const [showNewOrder, setShowNewOrder] = useState(false);
    const { data: tables, refetch: refetchTables } = usePolling(() => api.get('/tables').then((r) => r.data), 8000, [generation]);
    const { data: orders, refetch } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        8000,
        [generation]
    );

    const pickupProjection = useMemo(() => {
        const { live, prior } = partitionPriorPickupOrders(orders || []);
        const active = live.filter((order) => (
            order.order_type === 'recojo'
            && !order.table_id
            && !['entregado', 'pagado', 'cancelado'].includes(order.status)
        ));
        return { active, prior };
    }, [orders]);

    const cards = useMemo(() => {
        const byTable = Object.fromEntries((orders || []).filter((o) => o.table_id).map((o) => [o.table_id, o]));
        return (tables || [])
            .filter((t) => t.status !== 'inactiva' && (t.status !== 'disponible' || byTable[t.id] || t.active_attention_id))
            .map((t) => {
                const attentionOrder = activeAttentionOrder(t, orders || []);
                const o = t.active_attention_id ? attentionOrder : byTable[t.id] || t.active_order;
                const items = o?.items || [];
                const pendingPrep = items.filter((it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
                const ready = items.filter((it) => it.status === 'listo');
                const due = o && o.status !== 'cancelado' ? remaining(o) : 0;
                return { table: t, order: o, pendingPrep, ready, due };
            })
            .filter((c) => c.order || c.table.active_attention_id || c.table.status === 'pagada');
    }, [tables, orders]);

    const toPrep = cards.reduce((s, c) => s + c.pendingPrep.reduce((x, it) => x + (it.quantity || 0), 0), 0);
    const toReady = cards.reduce((s, c) => s + c.ready.reduce((x, it) => x + (it.quantity || 0), 0), 0);
    const toPay = cards.filter((c) => c.due > 0).length;

    const availableTables = useMemo(() => {
        return (tables || [])
            .filter((t) => t.status === 'disponible' && !t.active_order && !t.active_attention_id)
            .sort((a, b) => Number(a.number) - Number(b.number));
    }, [tables]);

    const selectTable = (tableId) => {
        setShowNewOrder(false);
        navigate(`/pedidos/nuevo?mesa=${tableId}`);
    };

    const refreshService = async () => Promise.allSettled([refetch(), refetchTables()]);

    const closeAttention = async (order) => {
        setClosing(order.id);
        try {
            await api.post(`/orders/${order.id}/attention/close`);
            toast.success('Atención cerrada');
            await refreshService();
        } catch (e) {
            await refreshService();
            toast.error(e.response?.data?.detail || 'No se pudo cerrar la atención. Puedes reintentar.');
        } finally {
            setClosing(null);
        }
    };

    const deliver = async (order) => {
        setDelivering(order.id);
        try {
            await api.post(`/orders/${order.id}/serve`);
            toast.success('Pedido entregado');
            refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo entregar');
        } finally {
            setDelivering(null);
        }
    };

    return (
        <div className="space-y-5" data-testid="servicio-root">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Servicio</p>
                    <h1 className="font-display text-3xl font-semibold">Mesas y cuentas</h1>
                    <p className="text-sm text-muted-foreground">
                        En cocina: {toPrep} · Listos: {toReady} · Por cobrar: {toPay}
                    </p>
                </div>
                <div className="flex gap-2">
                    {canTakeOrder && (
                        <Button className="h-11" onClick={() => setShowNewOrder(true)} data-testid="servicio-nuevo-pedido">
                            <Plus className="h-4 w-4 mr-1" /> Nuevo pedido
                        </Button>
                    )}
                    {toPrep > 0 && (
                        <Button variant="outline" className="h-11" onClick={() => navigate('/cocina')} data-testid="servicio-ir-cocina">
                            <ChefHat className="h-4 w-4 mr-1" /> Ir a cocina ({toPrep})
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {cards.map(({ table, order, pendingPrep, ready, due }) => {
                    const billRequested = Boolean(order?.payment_requested) || order?.status === 'pendiente_pago';
                    const allReady = ready.length > 0;
                    return (
                        <Card
                            key={table.id}
                            data-testid={`servicio-mesa-${table.number}`}
                            className={allReady ? 'border-[#A9CFF5] ring-1 ring-[#3B82F6]/30' : ''}
                        >
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-display text-xl font-semibold">Mesa {table.number}</div>
                                    <div className="flex flex-wrap gap-1 justify-end">
                                        {pendingPrep.length > 0 && (
                                            <span className="text-[10px] font-medium rounded-full bg-[#FFF6DB] text-[#6B4E00] border border-[#F3E2A6] px-2 py-0.5">
                                                {pendingPrep.reduce((s, it) => s + (it.quantity || 0), 0)} en cocina
                                            </span>
                                        )}
                                        {ready.length > 0 && (
                                            <span className="text-[10px] font-medium rounded-full bg-[#E0EEFF] text-[#0B3A66] border border-[#A9CFF5] px-2 py-0.5">
                                                {ready.reduce((s, it) => s + (it.quantity || 0), 0)} listos
                                            </span>
                                        )}
                                        {billRequested && (
                                            <span className="text-[10px] font-medium rounded-full bg-[#FFE0CC] text-[#8C3A12] border border-[#F5B488] px-2 py-0.5">
                                                Cuenta solicitada
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {due > 0 && (
                                    <div className="text-sm">Pendiente de pago: <span className="font-mono font-semibold">{fmtMoney(due)}</span></div>
                                )}
                                {order && <AttentionReference order={order} branchNames={branchNames} />}
                                {table.status === 'pagada' && due <= 0 && !table.active_attention_id && (
                                    <div className="text-sm text-muted-foreground">Cuenta pagada · liberá la mesa en Mesas</div>
                                )}
                                {table.active_attention_id && !order && (
                                    <div className="text-sm text-muted-foreground">Visita activa · actualizando pedido</div>
                                )}
                                {table.active_attention_id && order?.status === 'pagado' && ready.length === 0 && (
                                    <div className="text-sm text-muted-foreground">Cuenta pagada · cierra la atención para liberar la mesa</div>
                                )}
                                {table.active_attention_id && order && order.status !== 'pagado' && order.status !== 'cancelado' && (
                                    <div className="text-sm text-muted-foreground">Cierra la atención después de cobrar y entregar los productos</div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    {order && (
                                        <Button className="h-11" onClick={() => navigate(`/pedidos/${order.id}`)}>Abrir mesa</Button>
                                    )}
                                    {order && ready.length > 0 && canServe && (
                                        <Button
                                            variant="secondary"
                                            className="h-11"
                                            onClick={() => deliver(order)}
                                            disabled={delivering === order.id}
                                            data-testid={`servicio-entregar-${table.number}`}
                                        >
                                            <CheckCheck className="h-4 w-4 mr-1" /> Entregar
                                        </Button>
                                    )}
                                    {canClose && canCloseAttention(table, order) && (
                                        <Button
                                            variant="outline"
                                            className="h-11"
                                            onClick={() => closeAttention(order)}
                                            disabled={closing === order.id}
                                            data-testid={`servicio-cerrar-${table.number}`}
                                        >
                                            {closing === order.id ? 'Cerrando…' : 'Finalizar mesa'}
                                        </Button>
                                    )}
                                    {canCharge && order && due > 0 && (
                                        <Button variant={billRequested ? 'default' : 'secondary'} className="h-11" asChild>
                                            <Link to={`/caja?order=${order.id}`}>Cobrar</Link>
                                        </Button>
                                    )}
                                    {!order && table.status === 'disponible' && (
                                        <Button className="h-11" asChild><Link to={`/pedidos/nuevo?mesa=${table.id}`}>Tomar pedido</Link></Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
            {cards.length === 0 && (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        No hay mesas ocupadas.{' '}
                        <Link className="underline" to="/pedidos/nuevo">Tomar un pedido</Link>
                    </CardContent>
                </Card>
            )}

            {pickupProjection.active.length > 0 && (
                <section className="rounded-md border border-border bg-card/50 p-3" data-testid="servicio-recojos-activos">
                    <h2 className="font-semibold">Recojos activos · {pickupProjection.active.length}</h2>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pickupProjection.active.map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 rounded-sm border border-border p-3" data-testid={`servicio-recojo-${order.id}`}>
                                <div>
                                    <p className="font-medium">{order.order_number ? `Pedido #${order.order_number}` : 'Pedido'}</p>
                                    <AttentionReference order={order} branchNames={branchNames} />
                                    <p className="text-sm text-muted-foreground">{order.status === 'listo' ? 'Listo para recojo' : 'En preparación'}</p>
                                </div>
                                <Link className="shrink-0 text-sm underline" to={`/pedidos/${order.id}`}>Ver pedido</Link>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {pickupProjection.prior.length > 0 && (
                <details className="rounded-md border border-border bg-card/50 p-3" data-testid="servicio-dias-anteriores">
                    <summary className="cursor-pointer font-semibold">
                        Días anteriores · {pickupProjection.prior.length} recojo(s) listos
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pickupProjection.prior.map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 rounded-sm border border-border p-3" data-testid={`servicio-recojo-anterior-${order.id}`}>
                                <div>
                                    <p className="font-medium">{order.order_number ? `Pedido #${order.order_number}` : 'Pedido'}</p>
                                    <AttentionReference order={order} branchNames={branchNames} />
                                    <p className="text-sm text-muted-foreground">Listo para recojo</p>
                                </div>
                                <Link className="shrink-0 text-sm underline" to={`/pedidos/${order.id}`}>Ver pedido</Link>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Modal: Seleccionar mesa para nuevo pedido */}
            <Dialog open={showNewOrder} onOpenChange={setShowNewOrder}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Seleccionar mesa</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        {availableTables.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                No hay mesas disponibles en este momento.
                            </p>
                        ) : (
                            <div className="grid grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto">
                                {availableTables.map((table) => (
                                    <button
                                        key={table.id}
                                        onClick={() => selectTable(table.id)}
                                        className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5 transition-colors"
                                        data-testid={`servicio-mesa-disponible-${table.number}`}
                                    >
                                        <span className="font-display text-2xl font-bold">{table.number}</span>
                                        <span className="text-xs text-muted-foreground mt-1">{table.area}</span>
                                        <span className="text-[10px] text-muted-foreground">{table.capacity} pers.</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
