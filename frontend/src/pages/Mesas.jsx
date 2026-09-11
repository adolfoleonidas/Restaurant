import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { fmtMoney } from '@/lib/format';
import { Users, Plus, Search, Grid2X2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { toast } from 'sonner';

const STATE_BAR = {
    libre: 'bg-[hsl(90,40%,38%)]',
    sentados: 'bg-[hsl(28,45%,42%)]',
    preparando: 'bg-[hsl(38,72%,42%)]',
    listo: 'bg-[hsl(72,50%,38%)]',
    cuenta: 'bg-accent',
    entregado: 'bg-[hsl(200,30%,40%)]',
    reservada: 'bg-[hsl(16,40%,40%)]',
    inactiva: 'bg-muted',
};

function floorState(t) {
    const o = t.active_order;
    if (t.status === 'inactiva') return { key: 'inactiva', label: 'Inactiva' };
    if (t.status === 'reservada' && !o) return { key: 'reservada', label: 'Reservada' };
    if (t.status === 'disponible' && !o) return { key: 'libre', label: 'Libre' };
    if (o?.status === 'pendiente_pago' || t.status === 'esperando_pago') return { key: 'cuenta', label: 'Cuenta solicitada' };
    if (o?.status === 'listo') return { key: 'listo', label: 'Listo para entregar' };
    if (o?.status === 'entregado') return { key: 'entregado', label: 'Entregado' };
    if (o && ['enviado_cocina', 'en_preparacion', 'nuevo'].includes(o.status)) return { key: 'preparando', label: 'Preparando' };
    if (t.status === 'ocupada' && !o) return { key: 'sentados', label: 'En mesa' };
    return { key: 'sentados', label: 'Ocupada' };
}

export default function Mesas() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [statusFilter, setStatusFilter] = useState('todos');

    const { generation } = useNotify();
    const { data: tables, refetch } = usePolling(
        () => api.get('/tables').then((r) => r.data),
        12000,
        [generation]
    );

    const areas = useMemo(() => {
        const s = new Set((tables || []).map((t) => t.area));
        return ['todas', ...Array.from(s)];
    }, [tables]);

    const filtered = useMemo(() => {
        return (tables || []).filter((t) => {
            if (areaFilter !== 'todas' && t.area !== areaFilter) return false;
            if (statusFilter !== 'todos' && t.status !== statusFilter) return false;
            if (search && !`${t.number} ${t.name}`.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [tables, areaFilter, statusFilter, search]);

    const openOrCreate = async (table) => {
        if (table.active_order) {
            navigate(`/pedidos/${table.active_order.id}`);
            return;
        }
        if (!['admin', 'mozo'].includes(user.role)) {
            toast.info('Solo el mozo puede tomar la mesa');
            return;
        }
        if (table.status === 'ocupada') {
            navigate(`/pedidos/nuevo?mesa=${table.id}`);
            return;
        }
        if (table.status !== 'disponible') {
            toast.info('Esta mesa no está disponible');
            return;
        }
        try {
            await api.post(`/tables/${table.id}/seat`);
            navigate(`/pedidos/nuevo?mesa=${table.id}`);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo tomar la mesa');
        }
    };

    return (
        <div className="space-y-5" data-testid="mesas-root">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Salón</p>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Grid2X2 className="h-6 w-6 text-primary" /> Mesas</h1>
                    <p className="text-muted-foreground text-sm">Tocá una mesa libre para tomar el pedido. No se manda a cocina hasta que envíes.</p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-48" placeholder="Buscar mesa" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="mesas-search-input" />
                    </div>
                </div>
            </div>

            {/* Legend */}
            <Card>
                <CardContent className="p-3 flex flex-wrap gap-2 items-center">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">Estados:</span>
                    {['Libre', 'En mesa', 'Preparando', 'Listo para entregar', 'Cuenta solicitada'].map((s) => (
                        <span key={s} className="text-xs px-2 py-1 rounded-sm border border-border">{s}</span>
                    ))}
                </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
                {areas.map((a) => (
                    <button
                        key={a}
                        onClick={() => setAreaFilter(a)}
                        data-testid={`mesas-area-${a}`}
                        className={`px-3 py-1.5 rounded-sm text-sm font-medium transition-colors border ${areaFilter === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {a === 'todas' ? 'Todas las zonas' : a}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground">No hay mesas con esos filtros.</CardContent></Card>
            ) : (
                <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {filtered.map((t) => {
                        const floor = floorState(t);
                        return (
                        <Card
                            key={t.id}
                            data-testid={`mesa-card-${t.number}`}
                            onClick={() => openOrCreate(t)}
                            className={`cursor-pointer overflow-hidden rounded-sm hover:border-primary/50 transition-colors active:scale-[0.99] ${floor.key === 'listo' ? 'ring-2 ring-primary' : ''}`}
                        >
                            <div className={`h-2 ${STATE_BAR[floor.key] || 'bg-muted'}`} />
                            <CardContent className="p-4 flex flex-col gap-3 min-h-[148px]">
                                <div>
                                    <div className="font-display italic text-3xl font-bold leading-none">{t.number}</div>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                                        <Users className="h-3.5 w-3.5" /> {t.capacity} · {t.area}
                                    </div>
                                </div>
                                <div className="text-sm font-semibold">{floor.label}</div>
                                {t.active_order && (
                                    <div className="text-xs space-y-1">
                                        <div className="flex justify-between gap-2">
                                            <span className="page-kicker">
                                                {t.active_order.source === 'public' ? 'Carta web' : 'Salón'}
                                            </span>
                                            {t.active_order.total != null && (
                                                <span className="font-mono font-semibold tabular-nums text-primary">{fmtMoney(t.active_order.total)}</span>
                                            )}
                                        </div>
                                        <div className="text-muted-foreground truncate">
                                            {t.active_order.item_count || 0} {(t.active_order.item_count || 0) === 1 ? 'plato' : 'platos'}
                                            {t.active_order.customer_name ? ` · ${t.active_order.customer_name}` : ''}
                                        </div>
                                    </div>
                                )}
                                <Button size="sm" className="mt-auto h-11 rounded-sm text-base" data-testid={`mesa-action-${t.number}`}>
                                    {t.active_order ? (floor.key === 'listo' ? 'Entregar' : 'Ver pedido') : t.status === 'disponible' ? <><Plus className="h-4 w-4 mr-1" /> Tomar mesa</> : t.status === 'ocupada' ? 'Tomar pedido' : 'Ver'}
                                </Button>
                            </CardContent>
                        </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
