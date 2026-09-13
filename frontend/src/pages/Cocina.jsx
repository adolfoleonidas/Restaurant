import React, { useMemo } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { fmtElapsed, elapsedMinutes, ORDER_TYPE_LABELS } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';

function itemStage(it) {
    const st = it.status || 'pendiente';
    if (st === 'en_preparacion') return 'fuego';
    if (st === 'listo') return 'listo';
    if (st === 'entregado' || st === 'cancelado') return 'done';
    return 'llegan';
}

function waveTime(order, items) {
    const times = items.map((it) => it.added_at || it.ready_at).filter(Boolean);
    return times[0] || order.sent_to_kitchen_at || order.created_at;
}

function timerClass(iso) {
    const m = elapsedMinutes(iso);
    if (m >= 15) return 'text-accent font-bold';
    if (m >= 10) return 'text-primary font-semibold';
    return 'text-muted-foreground';
}

const KitchenCard = ({ order, items, stage, added, onBump, onItem }) => {
    const when = waveTime(order, items);
    const mesa = order.table_number && order.table_number !== '—'
        ? order.table_number.replace(/^Mesa\s*/i, '')
        : (order.table_id ? '' : null);
    const place = mesa
        ? `Mesa ${mesa}`
        : (ORDER_TYPE_LABELS[order.order_type] || 'Para llevar');

    return (
        <Card
            data-testid={`cocina-ticket-${order.order_number}-${stage}`}
            className={`rounded-sm cursor-pointer active:scale-[0.99] ${stage === 'listo' ? '' : 'hover:border-primary/60'}`}
            onClick={() => stage !== 'listo' && onBump(order, stage)}
        >
            <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <div className="font-display italic text-3xl font-bold leading-none">{place}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                            #{order.order_number}
                            {order.source === 'public' ? ' · carta web' : ''}
                            {added ? ' · agregado' : ''}
                        </div>
                    </div>
                    <span className={`font-mono text-sm tabular-nums ${timerClass(when)}`}>{fmtElapsed(when)}</span>
                </div>
                <div className="mt-3 space-y-2">
                    {items.map((it) => (
                        <div key={it.id} className="flex items-start justify-between gap-2">
                            <div>
                                <div className="text-lg font-semibold leading-tight">{it.quantity} × {it.product_name}</div>
                                {it.is_combo && (it.combo_components || []).map((c) => (
                                    <div key={c.product_id} className="text-xs text-muted-foreground">{c.quantity}× {c.product_name}</div>
                                ))}
                                {it.notes && <div className="text-sm italic text-primary">{it.notes}</div>}
                            </div>
                            {stage === 'fuego' && (
                                <button
                                    type="button"
                                    className="shrink-0 text-xs font-semibold px-2 py-1 rounded-sm border border-primary text-primary"
                                    onClick={(e) => { e.stopPropagation(); onItem(order, it); }}
                                >
                                    Listo
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                {order.notes && stage !== 'listo' && (
                    <div className="mt-3 text-sm text-primary">{order.notes}</div>
                )}
                {stage !== 'listo' && (
                    <div className="mt-3 text-[11px] text-muted-foreground">Tocá la tarjeta para avanzar</div>
                )}
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
        return (orders || []).map((o) => ({
            ...o,
            table_number: tableMap[o.table_id]?.name || tableMap[o.table_id]?.number || (o.table_id ? '—' : 'P/llevar'),
        }));
    }, [orders, tables]);

    const columns = useMemo(() => {
        const llegan = [];
        const fuego = [];
        const listos = [];
        for (const o of enriched) {
            const items = o.items || [];
            const a = items.filter((it) => itemStage(it) === 'llegan');
            const b = items.filter((it) => itemStage(it) === 'fuego');
            const c = items.filter((it) => itemStage(it) === 'listo');
            const hasOlder = items.some((it) => itemStage(it) === 'listo' || itemStage(it) === 'fuego' || itemStage(it) === 'done');
            if (a.length) llegan.push({ order: o, items: a, added: hasOlder, t: waveTime(o, a) });
            if (b.length) fuego.push({ order: o, items: b, added: false, t: waveTime(o, b) });
            if (c.length) listos.push({ order: o, items: c, added: false, t: waveTime(o, c) });
        }
        const byAge = (x, y) => String(x.t || '').localeCompare(String(y.t || ''));
        const byAgeDesc = (x, y) => String(y.t || '').localeCompare(String(x.t || ''));
        return [
            { key: 'llegan', label: 'Llegan', cards: llegan.sort(byAgeDesc) },
            { key: 'fuego', label: 'Al fuego', cards: fuego.sort(byAge) },
            { key: 'listo', label: 'Esperando retiro', cards: listos.sort(byAge) },
        ];
    }, [enriched]);

    const bump = async (order, stage) => {
        const from_status = stage === 'llegan' ? 'pendiente' : 'en_preparacion';
        try {
            await api.post(`/orders/${order.id}/bump`, { from_status });
            await refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo avanzar');
        }
    };

    const bumpItem = async (order, item) => {
        try {
            await api.post(`/orders/${order.id}/items/${item.id}/status`, { status: 'listo' });
            await refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo marcar');
        }
    };

    return (
        <div className="space-y-4" data-testid="cocina-root">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Pase</p>
                    <h1 className="font-display italic text-3xl font-semibold">Cocina</h1>
                </div>
                <Button asChild variant="outline" className="h-10">
                    <Link to="/disponibilidad">Agotar plato</Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1.2fr_0.8fr] gap-3 md:gap-4">
                {columns.map((col) => (
                    <div key={col.key} className="rounded-sm border border-border bg-card/50 p-3" data-testid={`cocina-columna-${col.key}`}>
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="font-display text-lg font-semibold">{col.label}</h2>
                            <span className="text-sm tabular-nums text-muted-foreground">{col.cards.length}</span>
                        </div>
                        <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
                            {col.cards.length === 0 ? (
                                <div className="text-center text-sm text-muted-foreground py-10">Vacío</div>
                            ) : col.cards.map((c) => (
                                <KitchenCard
                                    key={`${c.order.id}-${col.key}`}
                                    order={c.order}
                                    items={c.items}
                                    stage={col.key === 'fuego' ? 'fuego' : col.key === 'listo' ? 'listo' : 'llegan'}
                                    added={c.added}
                                    onBump={bump}
                                    onItem={bumpItem}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
