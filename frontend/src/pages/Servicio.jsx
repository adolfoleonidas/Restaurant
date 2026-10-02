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
import { ChefHat, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { canCloseAttention, itemsReadyToClose, paymentAwaitingCheck, postCloseAttention } from '@/lib/attentionClose';

function remaining(order) {
    const total = Number(order.total || 0);
    const paid = Number(order.amount_paid || 0);
    return Math.max(0, Math.round((total - paid) * 100) / 100);
}

export default function Servicio() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { generation } = useNotify();
    const canCharge = hasFn(user, 'cobro', 'administracion');
    const canServe = hasFn(user, 'preparacion', 'atencion', 'administracion');
    const [delivering, setDelivering] = useState(null);
    const [closingId, setClosingId] = useState(null);
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 8000, [generation]);
    const { data: orders, refetch } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        8000,
        [generation]
    );

    const cards = useMemo(() => {
        const byTable = Object.fromEntries((orders || []).filter((o) => o.table_id).map((o) => [o.table_id, o]));
        return (tables || [])
            .filter((t) => t.status !== 'inactiva' && (t.status !== 'disponible' || byTable[t.id]))
            .map((t) => {
                const o = byTable[t.id] || t.active_order;
                const items = o?.items || [];
                const pendingPrep = items.filter((it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
                const ready = items.filter((it) => it.status === 'listo');
                const due = o ? remaining(o) : 0;
                return { table: t, order: o, pendingPrep, ready, due };
            })
            .filter((c) => c.order);
    }, [tables, orders]);

    const toPrep = cards.reduce((s, c) => s + c.pendingPrep.reduce((x, it) => x + (it.quantity || 0), 0), 0);
    const toReady = cards.reduce((s, c) => s + c.ready.reduce((x, it) => x + (it.quantity || 0), 0), 0);
    const toPay = cards.filter((c) => c.due > 0).length;

    const closeAttention = async (order) => {
        if (closingId) return;
        setClosingId(order.id);
        try {
            await postCloseAttention(api, order);
            toast.success('Mesa libre');
            refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cerrar');
        } finally {
            setClosingId(null);
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
                    <h1 className="font-display italic text-3xl font-semibold">Mesas y cuentas</h1>
                    <p className="text-sm text-muted-foreground">
                        En cocina: {toPrep} · Listos: {toReady} · Por cobrar: {toPay}
                    </p>
                </div>
                {toPrep > 0 && (
                    <Button variant="outline" className="h-11" onClick={() => navigate('/cocina')} data-testid="servicio-ir-cocina">
                        <ChefHat className="h-4 w-4 mr-1" /> Ir a cocina ({toPrep})
                    </Button>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                {cards.map(({ table, order, pendingPrep, ready, due }) => {
                    const billRequested = order?.status === 'pendiente_pago';
                    const allReady = order?.status === 'listo';
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
                                {order && itemsReadyToClose(order) && paymentAwaitingCheck(order) && (
                                    <div className="text-sm text-muted-foreground">Pago por verificar</div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    {order && (
                                        <Button className="h-11" onClick={() => navigate(`/pedidos/${order.id}`)}>Abrir mesa</Button>
                                    )}
                                    {order && allReady && canServe && (
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
                                    {canCloseAttention(user) && order && itemsReadyToClose(order) && !paymentAwaitingCheck(order) && (
                                        <Button
                                            className="h-11"
                                            onClick={() => closeAttention(order)}
                                            disabled={closingId === order.id}
                                            data-testid={`servicio-cerrar-${table.number}`}
                                        >
                                            Cobrar y cerrar
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
        </div>
    );
}
