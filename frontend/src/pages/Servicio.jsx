import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { useNotify } from '@/contexts/NotifyContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasFn } from '@/lib/functions';

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
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 8000, [generation]);
    const { data: orders } = usePolling(
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
                const due = o ? remaining(o) : 0;
                return { table: t, order: o, pendingPrep, due };
            })
            .filter((c) => c.order || c.table.status === 'pagada');
    }, [tables, orders]);

    const toPrep = cards.filter((c) => c.pendingPrep.length > 0).length;
    const toPay = cards.filter((c) => c.due > 0).length;

    return (
        <div className="space-y-5" data-testid="servicio-root">
            <div>
                <p className="page-kicker mb-1">Servicio</p>
                <h1 className="font-display italic text-3xl font-semibold">Mesas y cuentas</h1>
                <p className="text-sm text-muted-foreground">Por preparar: {toPrep} · Por cobrar: {toPay}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {cards.map(({ table, order, pendingPrep, due }) => (
                    <Card key={table.id} data-testid={`servicio-mesa-${table.number}`}>
                        <CardContent className="p-4 space-y-3">
                            <div className="font-display text-xl font-semibold">Mesa {table.number}</div>
                            {pendingPrep.length > 0 && (
                                <div className="text-sm">{pendingPrep.reduce((s, it) => s + (it.quantity || 0), 0)} pendientes de preparación</div>
                            )}
                            {due > 0 && (
                                <div className="text-sm">Pendiente de pago: <span className="font-mono font-semibold">{fmtMoney(due)}</span></div>
                            )}
                            {table.status === 'pagada' && due <= 0 && (
                                <div className="text-sm text-muted-foreground">Cuenta pagada · mesa ocupada</div>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {order && (
                                    <Button className="h-11" onClick={() => navigate(`/pedidos/${order.id}`)}>Abrir mesa</Button>
                                )}
                                {canCharge && order && due > 0 && (
                                    <Button variant="secondary" className="h-11" asChild>
                                        <Link to={`/caja?order=${order.id}`}>Cobrar</Link>
                                    </Button>
                                )}
                                {!order && table.status === 'disponible' && (
                                    <Button className="h-11" asChild><Link to="/pedidos/nuevo">Tomar pedido</Link></Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
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
