import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtElapsed } from '@/lib/format';
import { Users, Plus, Search, Grid2X2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const STATE_BORDER = {
    disponible: 'border-l-[#22C55E]',
    ocupada: 'border-l-[#EF4444]',
    esperando_pago: 'border-l-[#F59E0B]',
    reservada: 'border-l-[#8B5CF6]',
    inactiva: 'border-l-[#71717A]',
};

export default function Mesas() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [statusFilter, setStatusFilter] = useState('todos');

    const { data: tables, refetch } = usePolling(
        () => api.get('/tables').then((r) => r.data),
        3000
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
        if (table.status !== 'disponible') {
            toast.info('Esta mesa no está disponible para nuevo pedido');
            return;
        }
        if (!['admin', 'mozo'].includes(user.role)) {
            toast.info('Solo Mozo o Admin pueden abrir pedidos');
            return;
        }
        try {
            const { data } = await api.post('/orders', { table_id: table.id, order_type: 'mesa', items: [] });
            toast.success(`Pedido #${data.order_number} creado en ${table.name}`);
            navigate(`/pedidos/${data.id}`);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo abrir el pedido');
        }
    };

    return (
        <div className="space-y-5" data-testid="mesas-root">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Grid2X2 className="h-6 w-6" /> Mesas</h1>
                    <p className="text-muted-foreground text-sm">Selecciona una mesa para abrir o ver un pedido</p>
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
                    {['disponible', 'ocupada', 'esperando_pago', 'reservada', 'inactiva'].map((s) => (
                        <StateBadge key={s} status={s} type="table" />
                    ))}
                </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
                {areas.map((a) => (
                    <button
                        key={a}
                        onClick={() => setAreaFilter(a)}
                        data-testid={`mesas-area-${a}`}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${areaFilter === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {a === 'todas' ? 'Todas las zonas' : a}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground">No hay mesas con esos filtros.</CardContent></Card>
            ) : (
                <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {filtered.map((t) => (
                        <Card
                            key={t.id}
                            data-testid={`mesa-card-${t.number}`}
                            onClick={() => openOrCreate(t)}
                            className={`cursor-pointer border-l-8 ${STATE_BORDER[t.status] || 'border-l-muted'} hover:shadow-md transition-shadow active:scale-[0.99]`}
                        >
                            <CardContent className="p-4 flex flex-col gap-3 min-h-[140px]">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="font-display text-2xl font-bold">{t.name}</div>
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                            <Users className="h-3.5 w-3.5" /> {t.capacity} · {t.area}
                                        </div>
                                    </div>
                                </div>
                                <div><StateBadge status={t.status} type="table" /></div>
                                {t.active_order && (
                                    <div className="text-xs text-muted-foreground flex justify-between">
                                        <span>Pedido activo</span>
                                        <span className="font-semibold tabular-nums">{fmtMoney(t.active_order.total)}</span>
                                    </div>
                                )}
                                <Button size="sm" className="mt-auto h-10" data-testid={`mesa-action-${t.number}`}>
                                    {t.active_order ? 'Ver pedido' : t.status === 'disponible' ? <><Plus className="h-4 w-4 mr-1" /> Abrir</> : 'Detalles'}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
