import React, { useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link, useNavigate } from 'react-router-dom';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtElapsed, fmtTime, elapsedMinutes, ORDER_TYPE_LABELS } from '@/lib/format';
import { Plus, Receipt, DollarSign, ShieldCheck, Clock } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import AttentionReference from '@/components/AttentionReference';
import SalesAreasDialog, { newOrderPath } from '@/components/SalesAreasDialog';
import useBranchNames from '@/hooks/useBranchNames';

const WAITING_THRESHOLD_MIN = 15;

const FILTERS = [
    { value: 'activos', label: 'Activos' },
    { value: 'pendiente_pago', label: 'Pendiente pago' },
    { value: 'pagado', label: 'Pagados' },
    { value: 'cancelado', label: 'Cancelados' },
    { value: 'all', label: 'Todos' },
];

export default function Pedidos() {
    const [filter, setFilter] = useState('activos');
    const [showAreas, setShowAreas] = useState(false);
    const navigate = useNavigate();
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const { generation } = useNotify();

    const { data } = usePolling(
        () => {
            const params = {};
            if (filter === 'activos') params.active_only = true;
            else if (filter !== 'all') params.status = filter;
            return api.get('/orders', { params }).then((r) => r.data);
        },
        12000,
        [filter, generation]
    );

    // Only the sales-area dialog needs the floor, to offer the free tables.
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 15000);

    // Orders start from the same sales-area decision as the floor: "Nuevo pedido"
    // must not drop the waiter into the composer with the area already assumed.
    const handleAreaSelect = (type, table) => {
        setShowAreas(false);
        const path = newOrderPath(type, table);
        if (path) navigate(path);
    };

    return (
        <div className="space-y-5" data-testid="pedidos-root">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Receipt className="h-6 w-6 text-primary" /> Pedidos</h1>
                    <p className="text-muted-foreground text-sm">Historial y pedidos activos</p>
                </div>
                {['admin', 'mozo'].includes(user.role) && (
                    <Button className="h-11" onClick={() => setShowAreas(true)} data-testid="pedidos-nuevo-button">
                        <Plus className="h-4 w-4 mr-2" /> Nuevo pedido
                    </Button>
                )}
            </div>

            <Tabs value={filter} onValueChange={setFilter}>
                <TabsList className="flex flex-wrap h-auto">
                    {FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value} data-testid={`pedidos-filter-${f.value}`}>{f.label}</TabsTrigger>)}
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(data || []).map((o) => {
                    const mins = elapsedMinutes(o.created_at);
                    const isWaiting = mins >= WAITING_THRESHOLD_MIN && o.status !== 'pagado' && o.status !== 'cancelado';
                    const needsCobrar = o.status === 'pendiente_pago' && o.payment_status !== 'pagado' && o.payment_status !== 'comprobante_subido';
                    const needsVerify = o.payment_status === 'comprobante_subido';
                    const isPartial = o.payment_status === 'parcial';
                    const remaining = isPartial ? Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0)) : 0;

                    return (
                        <Card
                            key={o.id}
                            className={`hover:shadow-md transition-shadow ${isWaiting ? 'pedidos-card-waiting border-amber-400/60 bg-amber-50 dark:bg-amber-950/20' : ''}`}
                            data-testid={`pedidos-card-${o.order_number}`}
                        >
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="font-display text-xl font-bold flex items-center gap-2">
                                            #{o.order_number}
                                            {isWaiting && <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-label="Pedido esperando hace más de 15 min" />}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {fmtTime(o.created_at)} · hace {fmtElapsed(o.created_at)}
                                            {isWaiting && <span className="ml-1 text-amber-700 dark:text-amber-300 font-medium">· esperando atención</span>}
                                        </div>
                                        <AttentionReference order={o} branchNames={branchNames} />
                                    </div>
                                    <StateBadge status={o.status} type="order" />
                                </div>

                                {/* Payment status indicator */}
                                {o.payment_status && o.payment_status !== 'pendiente' && (
                                    <div className="mt-2">
                                        {o.payment_status === 'parcial' && (
                                            <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                                Pago parcial · Resta <span className="font-bold tabular-nums">{fmtMoney(remaining)}</span>
                                            </div>
                                        )}
                                        {o.payment_status === 'pagado' && (
                                            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Pagado</div>
                                        )}
                                        {o.payment_status === 'comprobante_subido' && (
                                            <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Comprobante subido · pendiente de verificación</div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-3 text-sm">
                                    <div className="text-muted-foreground">Tipo: <span className="text-foreground">{ORDER_TYPE_LABELS[o.order_type] || o.order_type}</span></div>
                                    <div className="text-muted-foreground">Mozo: <span className="text-foreground">{o.created_by_name || (o.source === 'public' ? 'Cliente web' : '—')}</span></div>
                                    <div className="text-muted-foreground">Items: <span className="text-foreground">{(o.items || []).length}</span></div>
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-2">
                                    <span className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</span>
                                    <div className="flex items-center gap-1.5">
                                        {needsVerify && (
                                            <Button
                                                asChild
                                                size="sm"
                                                variant="outline"
                                                className="border-blue-400 text-blue-700 dark:text-blue-300"
                                                data-testid={`pedidos-verificar-${o.order_number}`}
                                            >
                                                <Link to={`/pedidos/${o.id}`}>
                                                    <ShieldCheck className="h-4 w-4 mr-1" />
                                                    Verificar comprobante
                                                </Link>
                                            </Button>
                                        )}
                                        {needsCobrar && (
                                            <Button
                                                asChild
                                                size="sm"
                                                className="bg-primary"
                                                data-testid={`pedidos-cobrar-${o.order_number}`}
                                            >
                                                <Link to={`/pedidos/${o.id}`}>
                                                    <DollarSign className="h-4 w-4 mr-1" />
                                                    Cobrar
                                                </Link>
                                            </Button>
                                        )}
                                        <Button asChild size="sm" variant="outline" data-testid={`pedidos-ver-${o.order_number}`}>
                                            <Link to={`/pedidos/${o.id}`}>Ver</Link>
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
                {(data || []).length === 0 && (
                    <Card className="col-span-full"><CardContent className="py-16 text-center text-muted-foreground">No hay pedidos en esta vista</CardContent></Card>
                )}
            </div>

            {/* Sales areas — first decision of every order */}
            <SalesAreasDialog
                open={showAreas}
                onOpenChange={(open) => { if (!open) setShowAreas(false); }}
                tables={tables}
                onSelect={handleAreaSelect}
            />
        </div>
    );
}
