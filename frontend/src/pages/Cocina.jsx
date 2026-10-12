import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { bumpOrder, getKitchenOrders, setOrderItemStatus } from '@/lib/api/orders';
import { listTables } from '@/lib/api/tables';
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
import { apiErrorMessage } from '@/lib/apiError';

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
    // En modo oscuro (--accent y --primary son demasiado oscuros sobre la tarjeta,
    // 2,52:1 y 3,91:1) se usan variantes claras que llegan a 11,15:1 y 7,3:1.
    if (m >= 15) return 'text-accent font-bold dark:text-amber-300';
    if (m >= 10) return 'text-primary font-semibold dark:text-blue-300';
    return 'text-muted-foreground';
}

/** Non-table areas need packaging, so the badge is loud and colour-coded. */
const AREA_BADGE = {
    llevar: 'bg-amber-100 text-amber-900 border-amber-300',
    recojo: 'bg-blue-100 text-blue-900 border-blue-300',
    delivery: 'bg-violet-100 text-violet-900 border-violet-300',
};

/**
 * Cada carril del pase tiene su color, como una columna de tablero: el carril se
 * lee por su cabecera y su tinte, no por un borde alrededor de todo. Antes cada
 * columna era una caja con borde dentro de otra caja con borde, y la pantalla se
 * veía como un tablero de cuadros.
 */
const COLUMN_TONE = {
    llegan: {
        dot: 'bg-sky-500',
        column: 'border-sky-200 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30',
        count: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
    },
    fuego: {
        dot: 'bg-amber-500',
        column: 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30',
        count: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200',
    },
    listo: {
        dot: 'bg-emerald-500',
        column: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30',
        count: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    },
    retirado: {
        dot: 'bg-slate-400',
        column: 'border-border bg-muted/40',
        count: 'bg-secondary text-muted-foreground',
    },
};

const KitchenCard = ({ order, items, stage, added, onBump, onItem, branchNames }) => {
    const when = stage === 'retirado' ? (order.updated_at || order.created_at) : waveTime(order, items);
    const mesa = order.table_number && order.table_number !== '—'
        ? String(order.table_number).replace(/^Mesa\s*/i, '')
        : (order.table_id ? '' : null);
    const place = mesa
        ? `Mesa ${mesa}`
        : (ORDER_TYPE_LABELS[order.order_type] || 'Para llevar');

    return (
        <Card
            data-testid={`cocina-ticket-${order.order_number}-${stage}`}
            className={`rounded-lg border-border shadow-sm ${stage === 'retirado' ? 'opacity-70 shadow-none' : ''}`}
        >
            <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <div className="font-display text-3xl font-bold leading-none">{place}</div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                            #{order.order_number}
                            {order.source === 'public' ? ' · carta web' : ''}
                            {order.order_type && order.order_type !== 'mesa' && (
                                <span className={`ml-1 shrink-0 text-xs font-bold uppercase tracking-wide rounded-sm border px-2 py-0.5 ${AREA_BADGE[order.order_type] || 'bg-[#F2F2F2] text-[#3F3F46] border-[#D4D4D8]'}`} data-testid={`cocina-tipo-${order.order_number}`}>
                                    {ORDER_TYPE_LABELS[order.order_type] || order.order_type}
                                </span>
                            )}
                            {added ? ' · AGREGADO' : ''}
                        </div>
                        <AttentionReference order={order} branchNames={branchNames} />
                        {(order.customer_name || order.customer_address) && (
                            <div className="text-xs mt-0.5 text-muted-foreground" data-testid={`cocina-cliente-${order.order_number}`}>
                                {[order.customer_name, order.customer_phone, order.customer_address].filter(Boolean).join(' · ')}
                            </div>
                        )}
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
                                {it.notes && <div className="text-sm italic text-primary dark:text-sky-300">{it.notes}</div>}
                            </div>
                            {stage === 'fuego' && (
                                <button
                                    type="button"
                                    className="min-h-11 sm:min-h-10 shrink-0 text-sm font-semibold px-3 py-2 rounded-sm border border-primary text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <div className="mt-3 text-sm text-primary dark:text-sky-300">{order.notes}</div>
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
    const { data: orders, error: ordersError, loading: ordersLoading, refetch } = usePolling(
        () => getKitchenOrders().then((r) => r.data),
        12000,
        [generation]
    );
    const { data: tables } = usePolling(() => listTables().then((r) => r.data), 20000, [generation]);
    const [zone, setZone] = useState('todas');

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

    // Región viva para lectores de pantalla: el pase se actualiza por polling y
    // un pase nuevo llega sin aviso (4.1.3). Solo se anuncia al cambiar.
    const boardSummary = useMemo(() => {
        const byKey = Object.fromEntries(columns.map((c) => [c.key, c.cards.length]));
        return `${byKey.llegan} nuevos · ${byKey.fuego} en fuego · ${byKey.listo} listos para retiro · ${byKey.retirado} retirados`;
    }, [columns]);

    const bump = async (order, stage) => {
        const from_status = stage === 'llegan' ? 'pendiente' : 'en_preparacion';
        try {
            await bumpOrder(order.id, { from_status });
            await refetch();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo avanzar'));
        }
    };

    const bumpItem = async (order, item) => {
        try {
            await setOrderItemStatus(order.id, item.id, { status: 'listo' });
            await refetch();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo marcar'));
        }
    };

    return (
        <div className="space-y-4" data-testid="cocina-root">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Pase</p>
                    <h1 className="font-display text-3xl font-semibold">Cocina</h1>
                </div>
                {/* Sin `h-10`: el override anulaba el h-11 móvil del primitivo. */}
                <Button asChild variant="outline">
                    <Link to="/disponibilidad">Agotar plato</Link>
                </Button>
            </div>

            {(zones.length > 0 || enriched.some((o) => !o.table_id)) && (
                <div className="scroll-x flex items-center gap-2 pb-1">
                    {['todas', ...zones, 'llevar'].map((z) => (
                        <button
                            key={z}
                            type="button"
                            onClick={() => setZone(z)}
                            data-testid={`cocina-zona-${z}`}
                            className={`min-h-11 md:min-h-0 shrink-0 rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${zone === z ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                        >
                            {z === 'todas' ? 'Todas' : z === 'llevar' ? 'Para llevar' : z}
                        </button>
                    ))}
                </div>
            )}

            {ordersError && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <span className="font-medium">Sin conexión con el pase: los pedidos no se están actualizando.</span>
                    <Button variant="outline" className="h-11" onClick={() => refetch()}>Reintentar</Button>
                </div>
            )}

            <div role="status" aria-live="polite" className="sr-only">{boardSummary}</div>

            {/* El alto del pase sale del layout, no de un número mágico: el tablero
                se topa con el chrome real (cabecera + barra inferior) y cada columna
                es una columna flex cuya lista de tickets es flex-1 min-h-0. Antes, a
                844x390, `max-h-[calc(100dvh-300px)]` dejaba la columna en ~90 px (un
                solo ticket). Los 4 carriles pasan a xl: a 1024 px cada columna
                quedaba en ~210 px y el nombre del plato se apretaba. */}
            <div
                data-testid="cocina-kanban"
                className="flex w-full min-w-0 max-h-[calc(100dvh-var(--header-h)-var(--safe-top)-var(--bottom-nav-h)-var(--safe-bottom))] snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 md:grid md:max-h-none md:grid-cols-2 md:overflow-visible md:snap-none md:pb-0 xl:grid-cols-[1.2fr_1.2fr_0.8fr_0.9fr]"
            >
                {columns.map((col) => {
                    const tone = COLUMN_TONE[col.key] || COLUMN_TONE.retirado;
                    return (
                    <section
                        key={col.key}
                        className={`flex w-[90%] max-w-[24rem] shrink-0 snap-start min-w-0 flex-col rounded-xl border p-3 md:block md:w-auto md:max-w-none md:shrink md:p-4 ${tone.column}`}
                        data-testid={`cocina-columna-${col.key}`}
                    >
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                                <div className="min-w-0">
                                    <h2 className="font-display text-lg font-semibold truncate">{col.label}</h2>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        {col.key === 'listo' ? 'Listos para retiro' : col.key === 'retirado' ? 'Salieron de cocina' : 'Más antiguas primero'}
                                    </p>
                                </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${tone.count}`}>{col.cards.length}</span>
                        </div>
                        <div
                            role="region"
                            aria-label={`Pedidos en ${col.label}`}
                            tabIndex={0}
                            className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-y-contain pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-h-[calc(100dvh-230px)]"
                        >
                            {col.cards.length === 0 ? (
                                <div className="text-center text-sm text-muted-foreground py-10">
                                    {ordersLoading && !orders ? 'Cargando…' : ordersError ? 'Sin datos' : 'Vacío'}
                                </div>
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
                    );
                })}
            </div>

            {priorPickups.length > 0 && (
                <details className="rounded-md border border-border bg-card/50 p-3" data-testid="cocina-dias-anteriores">
                    {/* El resumen es lo único que se pulsa del bloque: 44 px en móvil. */}
                    <summary className="cursor-pointer font-semibold py-2.5 md:py-0">
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
