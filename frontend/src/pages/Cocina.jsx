import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { fmtElapsed, elapsedMinutes, ORDER_TYPE_LABELS } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { partitionPriorPickupOrders } from '@/lib/serviceDay';
import AttentionReference from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';

function itemStage(it) {
    const st = it.status || 'pendiente';
    if (st === 'en_preparacion') return 'fuego';
    if (st === 'listo') return 'listo';
    if (st === 'entregado' || st === 'cancelado') return 'done';
    return 'llegan';
}

function waveTime(order, items) {
    const earliest = items
        .map((it) => it.added_at || it.ready_at)
        .filter(Boolean)
        .map((value) => ({ value, timestamp: Date.parse(value) }))
        .filter(({ timestamp }) => Number.isFinite(timestamp))
        .sort((a, b) => a.timestamp - b.timestamp)[0];
    return earliest?.value || order.sent_to_kitchen_at || order.created_at;
}

function timerClass(iso) {
    const m = elapsedMinutes(iso);
    if (m >= 15) return 'text-accent font-bold';
    if (m >= 10) return 'text-primary font-semibold';
    return 'text-muted-foreground';
}

const KitchenCard = ({ order, items, stage, added, onBump, onItem, branchNames }) => {
    const when = stage === 'retirado' ? (order.updated_at || order.created_at) : waveTime(order, items);
    const mesa = order.table_number && order.table_number !== '—'
        ? order.table_number.replace(/^Mesa\s*/i, '')
        : (order.table_id ? '' : null);
    const place = mesa
        ? `Mesa ${mesa}`
        : (ORDER_TYPE_LABELS[order.order_type] || 'Para llevar');

    return (
        <Card
            data-testid={`cocina-ticket-${order.order_number}-${stage}`}
            className={`rounded-sm ${stage === 'retirado' ? 'opacity-70' : stage === 'listo' ? '' : 'border-primary/30'}`}
        >
            <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <div className="font-display italic text-3xl font-bold leading-none">{place}</div>
                        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                            #{order.order_number}
                            {order.source === 'public' ? ' · carta web' : ''}
                            {order.order_type && order.order_type !== 'mesa' && (
                                <span className="ml-1 shrink-0 text-[10px] font-medium rounded-full bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8] px-2 py-0.5" data-testid={`cocina-tipo-${order.order_number}`}>
                                    {ORDER_TYPE_LABELS[order.order_type] || order.order_type}
                                </span>
                            )}
                            {added ? ' · AGREGADO' : ''}
                        </div>
                        <AttentionReference order={order} branchNames={branchNames} />
                    </div>
                    <span className={`font-mono text-sm tabular-nums ${stage === 'retirado' ? 'text-muted-foreground' : timerClass(when)}`}>
                        {stage === 'retirado' ? `hace ${fmtElapsed(when)}` : fmtElapsed(when)}
                    </span>
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
                                    className="min-h-10 shrink-0 text-sm font-semibold px-3 py-2 rounded-sm border border-primary text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={`Marcar ${it.product_name} listo`}
                                    onClick={(e) => { e.stopPropagation(); onItem(order, it); }}
                                >
                                    Listo
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                {order.notes && ['llegan', 'fuego'].includes(stage) && (
                    <div className="mt-3 text-sm text-primary">{order.notes}</div>
                )}
                {['llegan', 'fuego'].includes(stage) && (
                    <button type="button" className="mt-4 min-h-11 w-full rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" onClick={() => onBump(order, stage)}>
                        {stage === 'llegan' ? 'Pasar a fuego' : 'Avanzar pedido'}
                    </button>
                )}
            </CardContent>
        </Card>
    );
};

export default function Cocina() {
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const { generation } = useNotify();
    const { data: orders, refetch } = usePolling(
        () => api.get('/orders/kitchen').then((r) => r.data),
        12000,
        [generation]
    );
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 20000, [generation]);
    const [zone, setZone] = useState('todas');
    const [selectedStage, setSelectedStage] = useState('llegan');

    const tableMap = useMemo(() => Object.fromEntries((tables || []).map((t) => [t.id, t])), [tables]);
    const zones = useMemo(() => [...new Set((tables || []).map((t) => t.area).filter(Boolean))].sort(), [tables]);

    const enriched = useMemo(() => {
        return (orders || []).map((o) => ({
            ...o,
            table_number: tableMap[o.table_id]?.name || tableMap[o.table_id]?.number || (o.table_id ? '—' : 'P/llevar'),
            table_area: tableMap[o.table_id]?.area || null,
        }));
    }, [orders, tableMap]);

    const scoped = useMemo(() => {
        if (zone === 'todas') return enriched;
        if (zone === 'llevar') return enriched.filter((o) => !o.table_id);
        return enriched.filter((o) => o.table_area === zone);
    }, [enriched, zone]);

    const { live: liveOrders, prior: priorPickups } = useMemo(
        () => partitionPriorPickupOrders(scoped),
        [scoped]
    );

    const columns = useMemo(() => {
        const llegan = [];
        const fuego = [];
        const listos = [];
        const retirados = [];
        for (const o of liveOrders) {
            const items = o.items || [];
            const a = items.filter((it) => itemStage(it) === 'llegan');
            const b = items.filter((it) => itemStage(it) === 'fuego');
            const c = items.filter((it) => itemStage(it) === 'listo');
            const hasOlder = items.some((it) => itemStage(it) === 'listo' || itemStage(it) === 'fuego' || itemStage(it) === 'done');
            if (a.length) llegan.push({ order: o, items: a, added: hasOlder, t: waveTime(o, a) });
            if (b.length) fuego.push({ order: o, items: b, added: false, t: waveTime(o, b) });
            if (c.length) listos.push({ order: o, items: c, added: false, t: waveTime(o, c) });
            if (o.status === 'entregado') retirados.push({ order: o, items, added: false, t: o.updated_at || o.created_at });
        }
        const byAge = (x, y) => String(x.t || '').localeCompare(String(y.t || ''));
        const byAgeDesc = (x, y) => String(y.t || '').localeCompare(String(x.t || ''));
        retirados.sort(byAgeDesc);
        return [
            { key: 'llegan', label: 'Llegan', cards: llegan.sort(byAge) },
            { key: 'fuego', label: 'Al fuego', cards: fuego.sort(byAge) },
            { key: 'listo', label: 'Esperando retiro', cards: listos.sort(byAge) },
            { key: 'retirado', label: 'Retirado', cards: retirados },
        ];
    }, [liveOrders]);

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

            {(zones.length > 0 || enriched.some((o) => !o.table_id)) && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {['todas', ...zones, 'llevar'].map((z) => (
                        <button
                            key={z}
                            type="button"
                            onClick={() => setZone(z)}
                            data-testid={`cocina-zona-${z}`}
                            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${zone === z ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                        >
                            {z === 'todas' ? 'Todas' : z === 'llevar' ? 'Para llevar' : z}
                        </button>
                    ))}
                </div>
            )}

            <div className="rounded-md border border-border bg-secondary/40 p-3 md:p-4">
                <div role="tablist" aria-label="Tandas por estado" className="mb-4 grid grid-cols-2 gap-2 md:hidden">
                    {columns.map((col) => (
                        <button key={col.key} id={`cocina-tab-${col.key}`} type="button" role="tab" aria-selected={selectedStage === col.key} aria-controls={`cocina-panel-${col.key}`} tabIndex={selectedStage === col.key ? 0 : -1} onClick={() => setSelectedStage(col.key)} onKeyDown={(event) => {
                            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                            event.preventDefault();
                            const index = columns.findIndex((item) => item.key === col.key);
                            const offset = event.key === 'ArrowRight' ? 1 : -1;
                            const nextStage = columns[(index + offset + columns.length) % columns.length].key;
                            setSelectedStage(nextStage);
                            document.getElementById(`cocina-tab-${nextStage}`)?.focus();
                        }} className={`flex min-h-12 items-center justify-between gap-2 rounded-sm border px-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedStage === col.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/60'}`}>
                            <span>{col.label}</span><span className="rounded-full bg-background/20 px-2 py-0.5 text-xs tabular-nums">{col.cards.length}</span>
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_0.8fr_0.9fr]">
                {columns.map((col) => (
                    <section key={col.key} id={`cocina-panel-${col.key}`} role="tabpanel" aria-labelledby={`cocina-tab-${col.key}`} className={`${selectedStage === col.key ? 'block' : 'hidden'} min-w-0 rounded-sm border border-border bg-card p-3 md:block md:p-4`} data-testid={`cocina-columna-${col.key}`}>
                        <div className="flex items-center justify-between mb-3">
                            <div><h2 className="font-display text-lg font-semibold">{col.label}</h2><p className="mt-0.5 text-xs text-muted-foreground">{col.key === 'listo' ? 'Listos para retiro' : col.key === 'retirado' ? 'Salieron de cocina' : 'Más antiguas primero'}</p></div>
                            <span className="rounded-full bg-secondary px-2.5 py-1 text-sm font-semibold tabular-nums">{col.cards.length}</span>
                        </div>
                        <div className="max-h-[calc(100dvh-300px)] space-y-3 overflow-y-auto pr-1 md:max-h-[calc(100vh-230px)]">
                            {col.cards.length === 0 ? (
                                <div className="text-center text-sm text-muted-foreground py-10">Vacío</div>
                            ) : col.cards.map((c) => (
                                <KitchenCard
                                    key={`${c.order.id}-${col.key}`}
                                    order={c.order}
                                    items={c.items}
                                    stage={col.key === 'retirado' ? 'retirado' : col.key === 'fuego' ? 'fuego' : col.key === 'listo' ? 'listo' : 'llegan'}
                                    added={c.added}
                                    onBump={bump}
                                    onItem={bumpItem}
                                    branchNames={branchNames}
                                />
                            ))}
                        </div>
                    </section>
                ))}
                </div>
            </div>

            {priorPickups.length > 0 && (
                <details className="rounded-md border border-border bg-card/50 p-3" data-testid="cocina-dias-anteriores">
                    <summary className="cursor-pointer font-semibold">
                        Días anteriores · {priorPickups.length} recojo(s) listos
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {priorPickups.map((order) => (
                            <div key={order.id} className="rounded-sm border border-border p-3" data-testid={`cocina-recojo-anterior-${order.id}`}>
                                <p className="font-semibold">Pedido #{order.order_number}</p>
                                <AttentionReference order={order} branchNames={branchNames} />
                                <p className="text-sm text-muted-foreground">Listo para recojo</p>
                                <Link className="mt-2 inline-block text-sm underline" to={`/pedidos/${order.id}`}>Ver pedido</Link>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
