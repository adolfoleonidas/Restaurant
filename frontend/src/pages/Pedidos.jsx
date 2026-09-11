import React, { useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtElapsed, fmtTime } from '@/lib/format';
import { Plus, Receipt } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';

const FILTERS = [
    { value: 'activos', label: 'Activos' },
    { value: 'pendiente_pago', label: 'Pendiente pago' },
    { value: 'pagado', label: 'Pagados' },
    { value: 'cancelado', label: 'Cancelados' },
    { value: 'all', label: 'Todos' },
];

export default function Pedidos() {
    const [filter, setFilter] = useState('activos');
    const { user } = useAuth();
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

    return (
        <div className="space-y-5" data-testid="pedidos-root">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Receipt className="h-6 w-6 text-primary" /> Pedidos</h1>
                    <p className="text-muted-foreground text-sm">Historial y pedidos activos</p>
                </div>
                {['admin', 'mozo'].includes(user.role) && (
                    <Button asChild className="h-11" data-testid="pedidos-nuevo-button">
                        <Link to="/pedidos/nuevo"><Plus className="h-4 w-4 mr-2" /> Nuevo pedido</Link>
                    </Button>
                )}
            </div>

            <Tabs value={filter} onValueChange={setFilter}>
                <TabsList className="flex flex-wrap h-auto">
                    {FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value} data-testid={`pedidos-filter-${f.value}`}>{f.label}</TabsTrigger>)}
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(data || []).map((o) => (
                    <Card key={o.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="font-display text-xl font-bold">#{o.order_number}</div>
                                    <div className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · hace {fmtElapsed(o.created_at)}</div>
                                </div>
                                <StateBadge status={o.status} type="order" />
                            </div>
                            <div className="mt-3 text-sm">
                                <div className="text-muted-foreground">Mozo: <span className="text-foreground">{o.created_by_name}</span></div>
                                <div className="text-muted-foreground">Items: <span className="text-foreground">{(o.items || []).length}</span></div>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                                <span className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</span>
                                <Button asChild size="sm" data-testid={`pedidos-ver-${o.order_number}`}><Link to={`/pedidos/${o.id}`}>Ver</Link></Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {(data || []).length === 0 && (
                    <Card className="col-span-full"><CardContent className="py-16 text-center text-muted-foreground">No hay pedidos en esta vista</CardContent></Card>
                )}
            </div>
        </div>
    );
}
