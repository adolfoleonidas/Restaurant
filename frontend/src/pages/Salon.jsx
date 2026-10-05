import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { fmtMoney, fmtElapsed, fmtDateTime, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, ORDER_AREAS } from '@/lib/format';
import { Search, Grid2X2, Plus, Users, ShoppingCart, Clock, UtensilsCrossed, Receipt, Bell, CheckCheck, ShoppingBag, PackageCheck, Bike } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { hasFn } from '@/lib/functions';
import { toast } from 'sonner';
import AttentionReference from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';
import { activeAttentionOrder, canCloseAttention } from '@/lib/attentionClose';
import { partitionPriorPickupOrders } from '@/lib/serviceDay';

/**
 * Salón — unified floor + service screen.
 *
 * Consolidates the former Mesas (floor grid, states, priority) and Servicio
 * (inline actions, summary, visit closure, pickups) screens into one
 * touch-first operating surface for the mozo/cajero/admin.
 *
 * Kept `data-testid` contracts: `mesa-card-*`, `mesa-card-deliver-*`,
 * `mesa-card-cobrar-*`, `data-floor-state`, `mesa-sheet-*`, `servicio-cerrar-*`,
 * `servicio-recojos-activos`, `servicio-recojo-*`, `servicio-dias-anteriores`.
 */

const FLOOR_STYLE = {
    libre: { label: 'Libre', bg: '#E7F6EE', fg: '#0F5132', border: '#BFE7D0', dot: '#22C55E' },
    sentados: { label: 'Ocupada', bg: '#FDE3E3', fg: '#8C1D1D', border: '#F5B5B5', dot: '#EF4444' },
    preparando: { label: 'Preparando', bg: '#FFF6DB', fg: '#6B4E00', border: '#F3E2A6', dot: '#F59E0B' },
    listo: { label: 'Listo', bg: '#E0EEFF', fg: '#0B3A66', border: '#A9CFF5', dot: '#3B82F6' },
    cuenta: { label: 'Cuenta', bg: '#FFE0CC', fg: '#8C3A12', border: '#F5B488', dot: '#E07A5F' },
    entregado: { label: 'Entregado', bg: '#EAF6F5', fg: '#0F4F49', border: '#BFE5E0', dot: '#14B8A6' },
    pagada: { label: 'Cuenta pagada', bg: '#F2F2F2', fg: '#3F3F46', border: '#D4D4D8', dot: '#71717A' },
    atencion: { label: 'Atención abierta', bg: '#F3F0FF', fg: '#3B2A66', border: '#D9D2F0', dot: '#7C6BC4' },
    reservada: { label: 'Reservada', bg: '#F3F0FF', fg: '#3B2A66', border: '#D9D2F0', dot: '#7C6BC4' },
    inactiva: { label: 'Inactiva', bg: '#EFEFEF', fg: '#71717A', border: '#D4D4D8', dot: '#A1A1AA' },
};

const LEGEND = ['libre', 'sentados', 'preparando', 'listo', 'cuenta', 'pagada', 'atencion', 'reservada'];

const STATE_FILTERS = [
    { key: 'todas', label: 'Todas' },
    { key: 'libre', label: 'Libres' },
    { key: 'activas', label: 'Ocupadas' },
    { key: 'listo', label: 'Por entregar' },
    { key: 'cuenta', label: 'Por cobrar' },
];

function floorState(t) {
    const o = t.active_order;
    if (t.status === 'inactiva') return { key: 'inactiva' };
    if (t.status === 'reservada' && !o) return { key: 'reservada' };
    if (o?.status === 'cancelado') return { key: 'atencion' };
    if (o?.status === 'pagado' || (t.status === 'pagada' && !o)) return { key: 'pagada' };
    if (t.status === 'disponible' && !o) return { key: 'libre' };
    if (o?.status === 'pendiente_pago' || t.status === 'esperando_pago') return { key: 'cuenta' };
    if (o?.status === 'listo') return { key: 'listo' };
    if (o?.status === 'entregado') return { key: 'entregado' };
    if (o && ['enviado_cocina', 'en_preparacion', 'nuevo'].includes(o.status)) return { key: 'preparando' };
    if (t.status === 'ocupada' && !o) return { key: 'sentados' };
    return { key: 'sentados' };
}

function itemQty(items, predicate) {
    return (items || []).filter(predicate).reduce((s, it) => s + (it.quantity || 0), 0);
}

export default function Salon() {
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const navigate = useNavigate();
    const { generation } = useNotify();

    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [stateFilter, setStateFilter] = useState('todas');
    const [openTable, setOpenTable] = useState(null);
    const [showNewOrder, setShowNewOrder] = useState(false);
    const [newOrderType, setNewOrderType] = useState(null);
    const [pendingTable, setPendingTable] = useState(null);
    const [closing, setClosing] = useState(null);

    const { data: tables, refetch: refetchTables } = usePolling(
        () => api.get('/tables').then((r) => r.data),
        8000,
        [generation]
    );
    const { data: liveOrders, refetch: refetchOrders } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        8000,
        [generation]
    );
    const orders = useMemo(() => (Array.isArray(liveOrders) ? liveOrders : []), [liveOrders]);

    const canServe = ['admin', 'mozo', 'cocina'].includes(user?.role);
    const canTake = ['admin', 'mozo'].includes(user?.role);
    const canClose = ['admin', 'mozo', 'cajero'].includes(user?.role);
    const canCharge = hasFn(user, 'cobro', 'administracion');

    const byTable = useMemo(() => {
        const map = {};
        for (const o of orders) if (o.table_id) map[o.table_id] = o;
        return map;
    }, [orders]);

    const openOrderId = openTable?.order?.id || null;
    const { data: liveOrderData } = usePolling(
        () => (openOrderId ? api.get(`/orders/${openOrderId}`).then((r) => r.data) : Promise.resolve(null)),
        10000,
        [openOrderId]
    );
    const sheetOrder = openTable?.order && liveOrderData && liveOrderData.id === openTable.order.id
        ? liveOrderData
        : (openTable?.order || null);

    // ── Summary (former Servicio header) ───────────────────────────────────
    const summary = useMemo(() => {
        let toPrep = 0;
        let toReady = 0;
        let toPay = 0;
        for (const o of orders) {
            const items = o.items || [];
            toPrep += itemQty(items, (it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
            toReady += itemQty(items, (it) => it.status === 'listo');
            const due = Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0));
            if (due > 0) toPay += 1;
        }
        return { toPrep, toReady, toPay };
    }, [orders]);

    const pickupProjection = useMemo(() => {
        const { live, prior } = partitionPriorPickupOrders(orders);
        const active = live.filter((o) => (
            o.order_type === 'recojo'
            && !o.table_id
            && !['entregado', 'pagado', 'cancelado'].includes(o.status)
        ));
        return { active, prior };
    }, [orders]);

    // ── Filters ────────────────────────────────────────────────────────────
    const areas = useMemo(() => {
        const s = new Set((tables || []).map((t) => t.area));
        return ['todas', ...Array.from(s)];
    }, [tables]);

    const decorated = useMemo(() => {
        return (tables || []).map((t) => {
            const floor = floorState(t);
            const listOrder = byTable[t.id] || null;
            const attentionOrder = activeAttentionOrder(t, orders);
            const displayOrder = t.active_order || attentionOrder || listOrder || null;
            const serviceOrder = t.active_attention_id ? attentionOrder : (listOrder || t.active_order || null);
            const items = serviceOrder?.items || [];
            const ready = itemQty(items, (it) => it.status === 'listo');
            const pendingPrep = itemQty(items, (it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
            const due = serviceOrder && serviceOrder.status !== 'cancelado'
                ? Math.max(0, Number(serviceOrder.total || 0) - Number(serviceOrder.amount_paid || 0))
                : 0;
            const billRequested = Boolean(serviceOrder?.payment_requested) || serviceOrder?.status === 'pendiente_pago';
            const showVisitaActiva = Boolean(t.active_attention_id) && !attentionOrder && Boolean(listOrder);
            return { table: t, floor, displayOrder, serviceOrder, ready, pendingPrep, due, billRequested, showVisitaActiva };
        });
    }, [tables, byTable, orders]);

    const filtered = useMemo(() => {
        const list = decorated.filter(({ table: t, floor }) => {
            if (areaFilter !== 'todas' && t.area !== areaFilter) return false;
            if (stateFilter === 'libre' && floor.key !== 'libre') return false;
            if (stateFilter === 'activas' && !['sentados', 'preparando', 'entregado', 'atencion'].includes(floor.key)) return false;
            if (stateFilter === 'listo' && floor.key !== 'listo') return false;
            if (stateFilter === 'cuenta' && floor.key !== 'cuenta') return false;
            if (search && !`${t.number} ${t.name}`.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
        // Fixed order by table number: the floor must not reshuffle on every
        // state change (it disorients the waiter mid-service). Urgency is shown
        // by colour, the state filters and the summary bar instead.
        return list.slice().sort((a, b) => Number(a.table.number) - Number(b.table.number));
    }, [decorated, areaFilter, stateFilter, search]);

    // ── Actions ────────────────────────────────────────────────────────────
    const openSheet = async (t) => {
        setOpenTable({ table: t, order: null, history: null, loading: Boolean(t.active_order) });
        if (t.active_order) {
            try {
                const { data } = await api.get(`/orders/${t.active_order.id}`);
                setOpenTable((s) => (s && s.table.id === t.id ? { ...s, order: data, loading: false } : s));
            } catch {
                setOpenTable((s) => (s && s.table.id === t.id ? { ...s, loading: false } : s));
            }
        }
        try {
            const { data } = await api.get('/orders', { params: { table_id: t.id, limit: 50 } });
            const past = (data || []).filter((o) => ['pagado', 'cancelado'].includes(o.status)).slice(0, 8);
            setOpenTable((s) => (s && s.table.id === t.id ? { ...s, history: past } : s));
        } catch { /* historial opcional */ }
    };

    const closeSheet = () => setOpenTable(null);
    const refreshAll = () => { refetchTables?.(); refetchOrders?.(); };

    const deliver = async (orderId) => {
        try {
            await api.post(`/orders/${orderId}/serve`);
            toast.success('Pedido entregado');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo entregar');
        }
    };

    const closeAttention = async (order) => {
        setClosing(order.id);
        try {
            await api.post(`/orders/${order.id}/attention/close`);
            toast.success('Atención cerrada');
            closeSheet();
            refreshAll();
        } catch (e) {
            refreshAll();
            toast.error(e.response?.data?.detail || 'No se pudo cerrar la atención. Puedes reintentar.');
        } finally {
            setClosing(null);
        }
    };

    const requestBill = async (order) => {
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'pendiente_pago' });
            toast.success('Cuenta solicitada');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo solicitar la cuenta');
        }
    };

    const takeTable = async (t) => {
        if (!canTake) { toast.info('Solo el mozo puede tomar la mesa'); return; }
        if (t.status === 'ocupada') {
            closeSheet();
            navigate(`/pedidos/nuevo?mesa=${t.id}`);
            return;
        }
        if (t.status !== 'disponible') {
            toast.info('Esta mesa no está disponible');
            return;
        }
        try {
            await api.post(`/tables/${t.id}/seat`);
            closeSheet();
            navigate(`/pedidos/nuevo?mesa=${t.id}`);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo tomar la mesa');
        }
    };

    const releaseTable = async (t) => {
        if (!canTake) return;
        try {
            await api.post(`/tables/${t.id}/release`);
            toast.success(`Mesa ${t.number} libre`);
            closeSheet();
            refetchTables?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo liberar');
        }
    };

    const availableTables = useMemo(
        () => (tables || []).filter((t) => t.status === 'disponible' && !t.active_order && !t.active_attention_id)
            .sort((a, b) => Number(a.number) - Number(b.number)),
        [tables]
    );

    const closeAreas = () => {
        setShowNewOrder(false);
        setNewOrderType(null);
        setPendingTable(null);
    };

    const openAreas = (table = null) => {
        setPendingTable(table || null);
        setNewOrderType(null);
        setShowNewOrder(true);
    };

    const goToOrder = (type, table) => {
        setShowNewOrder(false);
        setNewOrderType(null);
        setPendingTable(null);
        if (type === 'mesa') {
            if (!table) { toast.error('Seleccioná una mesa'); return; }
            navigate(`/pedidos/nuevo?mesa=${table.id}`);
            return;
        }
        navigate(`/pedidos/nuevo?tipo=${type}`);
    };

    // Areas grid: "mesa" needs a table (the one open in the sheet, or a pick).
    const chooseArea = (type) => {
        if (type !== 'mesa') { goToOrder(type, null); return; }
        if (pendingTable) { void takeTable(pendingTable); return; }
        setNewOrderType('mesa');
    };

    const areaLabel = (a) => (a === 'todas' ? 'Todas las zonas' : a);

    return (
        <div className="space-y-5" data-testid="salon-root">
            {/* Header + summary */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Salón</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
                        <Grid2X2 className="h-6 w-6 text-primary" /> Salón
                    </h1>
                    <p className="text-sm text-muted-foreground" data-testid="salon-resumen">
                        En cocina: {summary.toPrep} · Listos: {summary.toReady} · Por cobrar: {summary.toPay}
                    </p>
                </div>
                <div className="flex gap-2 items-center">
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-44" placeholder="Buscar mesa" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="salon-search-input" />
                    </div>
                    {summary.toPrep > 0 && (
                        <Button variant="outline" className="h-10" onClick={() => navigate('/cocina')} data-testid="salon-ir-cocina">
                            Cocina ({summary.toPrep})
                        </Button>
                    )}
                    {canTake && (
                        <Button onClick={() => openAreas()} className="h-10" data-testid="salon-nuevo-pedido">
                            <ShoppingCart className="h-4 w-4 mr-1" /> Nuevo pedido
                        </Button>
                    )}
                </div>
            </div>

            {/* State filter */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-testid="salon-filtros">
                {STATE_FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => setStateFilter(f.key)}
                        data-testid={`salon-filtro-${f.key}`}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${stateFilter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Zones + legend */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                {areas.map((a) => (
                    <button
                        key={a}
                        type="button"
                        onClick={() => setAreaFilter(a)}
                        data-testid={`mesas-area-${a}`}
                        className={`shrink-0 px-3 py-1.5 rounded-sm text-sm font-medium transition-colors border ${areaFilter === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {areaLabel(a)}
                    </button>
                ))}
                <div className="hidden lg:flex gap-2 items-center ml-auto" data-testid="salon-legend">
                    {LEGEND.map((k) => {
                        const s = FLOOR_STYLE[k];
                        return (
                            <span key={k} className="text-xs px-2 py-1 rounded-full border flex items-center gap-1.5 shrink-0" style={{ background: s.bg, borderColor: s.border, color: s.fg }}>
                                <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
                                {s.label}
                            </span>
                        );
                    })}
                </div>
            </div>

            {/* Floor grid */}
            {filtered.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground border rounded-xl">No hay mesas con esos filtros.</div>
            ) : (
                <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {filtered.map(({ table: t, floor, displayOrder, serviceOrder, ready, due, billRequested, showVisitaActiva }) => {
                        const s = FLOOR_STYLE[floor.key];
                        const needsAttention = ['listo', 'cuenta', 'atencion'].includes(floor.key);
                        const elapsed = displayOrder?.created_at ? fmtElapsed(displayOrder.created_at) : null;
                        const closeable = canClose && canCloseAttention(t, serviceOrder);
                        const showDeliver = canServe && (floor.key === 'listo' || ready > 0) && Boolean(serviceOrder);
                        const showCobrar = canCharge && floor.key === 'cuenta' && serviceOrder;
                        const overdue = due > 0 && serviceOrder;
                        return (
                            <div
                                key={t.id}
                                data-testid={`mesa-card-${t.number}`}
                                data-floor-state={floor.key}
                                onClick={() => openSheet(t)}
                                className={`rounded-xl border-2 flex flex-col text-left transition-transform cursor-pointer ${needsAttention ? 'ring-2 ring-offset-1' : ''}`}
                                style={{
                                    background: s.bg,
                                    borderColor: needsAttention ? s.dot : s.border,
                                    ...(needsAttention ? { ['--tw-ring-color']: s.dot } : {}),
                                }}
                            >
                                <div className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1 active:scale-[0.99] transition-transform">
                                    <div className="flex items-start justify-between gap-1">
                                        <div className="font-display text-3xl sm:text-4xl font-bold leading-none" style={{ color: s.fg }}>{t.number}</div>
                                        {needsAttention && (
                                            <span className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center" style={{ background: s.dot }} aria-label="Requiere atencion">
                                                <Bell className="h-3.5 w-3.5 text-white" />
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                                        <span className="text-sm font-semibold" style={{ color: s.fg }}>{s.label}</span>
                                        {billRequested && <span className="text-[10px] font-medium rounded-full bg-[#FFE0CC] text-[#8C3A12] border border-[#F5B488] px-2 py-0.5">Cuenta solicitada</span>}
                                    </div>
                                    {elapsed && !['libre', 'pagada', 'inactiva'].includes(floor.key) && (
                                        <div className="flex items-center gap-1 text-xs" style={{ color: s.fg, opacity: 0.75 }}>
                                            <Clock className="h-3 w-3" />
                                            <span>Hace {elapsed}</span>
                                        </div>
                                    )}
                                    {showVisitaActiva && <div className="text-xs" style={{ color: s.fg, opacity: 0.8 }}>Visita activa</div>}
                                    {displayOrder && <AttentionReference order={displayOrder} branchNames={branchNames} />}
                                    {overdue && <div className="text-xs font-semibold" style={{ color: s.fg }}>Debe {fmtMoney(due)}</div>}
                                    {displayOrder?.total != null && (
                                        <div className="text-xs font-mono font-semibold tabular-nums mt-auto" style={{ color: s.fg, opacity: 0.85 }}>{fmtMoney(displayOrder.total)}</div>
                                    )}
                                </div>
                                {(showDeliver || showCobrar || closeable || floor.key === 'libre' || floor.key === 'sentados') && (
                                    <div className="px-3 pb-3 sm:px-4 sm:pb-4 flex flex-col gap-1.5">
                                        {showDeliver && (
                                            <button
                                                type="button"
                                                className="h-9 rounded-lg text-sm font-semibold text-white transition-colors active:scale-[0.98]"
                                                style={{ background: FLOOR_STYLE.listo.dot }}
                                                onClick={(e) => { e.stopPropagation(); deliver(serviceOrder.id); }}
                                                data-testid={`mesa-card-deliver-${t.number}`}
                                            >
                                                <UtensilsCrossed className="h-3.5 w-3.5 inline mr-1" /> Entregar
                                            </button>
                                        )}
                                        {showCobrar && (
                                            <button
                                                type="button"
                                                className="h-9 rounded-lg text-sm font-semibold text-white transition-colors active:scale-[0.98]"
                                                style={{ background: FLOOR_STYLE.cuenta.dot }}
                                                onClick={(e) => { e.stopPropagation(); closeSheet(); navigate(`/pedidos/${serviceOrder.id}`); }}
                                                data-testid={`mesa-card-cobrar-${t.number}`}
                                            >
                                                <Receipt className="h-3.5 w-3.5 inline mr-1" /> Cobrar
                                            </button>
                                        )}
                                        {/* Card shortcut for taking an order: it opens the same sales-area
                                            decision as the sheet button, so no table is seated before the
                                            waiter picks mesa / llevar / recojo / delivery. */}
                                        {floor.key === 'libre' && canTake && (
                                            <button
                                                type="button"
                                                className="h-9 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]"
                                                style={{ background: s.border, color: s.fg }}
                                                onClick={(e) => { e.stopPropagation(); openAreas(t); }}
                                                data-testid={`mesa-card-pedir-${t.number}`}
                                            >
                                                <Plus className="h-3.5 w-3.5 inline mr-1" /> Tomar pedido
                                            </button>
                                        )}
                                        {floor.key === 'sentados' && canTake && (
                                            <button
                                                type="button"
                                                className="h-9 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]"
                                                style={{ background: s.border, color: s.fg }}
                                                onClick={(e) => { e.stopPropagation(); openAreas(t); }}
                                                data-testid={`mesa-card-pedir-${t.number}`}
                                            >
                                                Tomar pedido
                                            </button>
                                        )}
                                        {closeable && (
                                            <button
                                                type="button"
                                                className="h-9 rounded-lg text-sm font-semibold border transition-colors active:scale-[0.98]"
                                                style={{ borderColor: s.border, color: s.fg }}
                                                disabled={closing === serviceOrder.id}
                                                onClick={(e) => { e.stopPropagation(); closeAttention(serviceOrder); }}
                                                data-testid={`servicio-cerrar-${t.number}`}
                                            >
                                                <CheckCheck className="h-3.5 w-3.5 inline mr-1" /> {closing === serviceOrder.id ? 'Cerrando…' : 'Finalizar mesa'}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pickups (takeout) */}
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
                                <a
                                    className="shrink-0 text-sm underline"
                                    href={`/pedidos/${order.id}`}
                                    onClick={(e) => { e.preventDefault(); navigate(`/pedidos/${order.id}`); }}
                                >
                                    Ver pedido
                                </a>
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
                                <a
                                    className="shrink-0 text-sm underline"
                                    href={`/pedidos/${order.id}`}
                                    onClick={(e) => { e.preventDefault(); navigate(`/pedidos/${order.id}`); }}
                                >
                                    Ver pedido
                                </a>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Table detail sheet (secondary actions) */}
            <Sheet open={Boolean(openTable)} onOpenChange={(o) => { if (!o) closeSheet(); }}>
                <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-testid="mesa-sheet">
                    {openTable && (() => {
                        const { table: t, history, loading } = openTable;
                        const order = sheetOrder;
                        const floor = floorState(t);
                        const s = FLOOR_STYLE[floor.key];
                        const closeable = canClose && canCloseAttention(t, order);
                        const billRequested = Boolean(order?.payment_requested) || order?.status === 'pendiente_pago';
                        return (
                            <>
                                <div className="p-5 border-b" style={{ background: s.bg }}>
                                    <p className="page-kicker" style={{ color: s.fg }}>Mesa {t.number} · {t.area}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="h-3 w-3 rounded-full" style={{ background: s.dot }} />
                                        <h2 className="font-display text-2xl font-semibold" style={{ color: s.fg }}>{s.label}</h2>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs mt-1" style={{ color: s.fg, opacity: 0.8 }}>
                                        <Users className="h-3.5 w-3.5" /> Capacidad {t.capacity} personas
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                    {t.active_order && loading && <div className="text-sm text-muted-foreground">Cargando pedido…</div>}
                                    {order && (
                                        <>
                                            <div className="text-sm text-muted-foreground space-y-1">
                                                <div>Pedido #{order.order_number} · {order.source === 'public' ? 'Carta web' : 'Salón'}</div>
                                                <AttentionReference order={order} branchNames={branchNames} />
                                                {order.customer_name && <div>Cliente: <span className="text-foreground">{order.customer_name}</span></div>}
                                                <div>Hace {fmtElapsed(order.created_at)} · {ORDER_STATUS_LABELS[order.status] || order.status}</div>
                                            </div>
                                            <div className="border rounded-xl divide-y">
                                                {(order.items || []).filter((i) => i.status !== 'cancelado').map((it) => (
                                                    <div key={it.id} className="flex justify-between gap-2 py-2 px-3 text-sm">
                                                        <span>{it.quantity}× {it.product_name}</span>
                                                        <span className="font-mono tabular-nums shrink-0">{fmtMoney(it.subtotal)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex justify-between font-display text-lg font-bold">
                                                <span>Total</span>
                                                <span className="font-mono tabular-nums">{order.total != null ? fmtMoney(order.total) : '—'}</span>
                                            </div>
                                        </>
                                    )}
                                    {!t.active_order && <p className="text-sm text-muted-foreground">Sin pedido activo en esta mesa.</p>}
                                    {t.active_attention_id && order && (
                                        <p className="text-sm text-muted-foreground">La visita sigue abierta. Finalizala cuando el cobro y la entrega estén completos.</p>
                                    )}
                                    {history && history.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="page-kicker">Turnos anteriores</div>
                                            <div className="border rounded-xl divide-y">
                                                {history.map((o) => (
                                                    <div key={o.id} className="py-2 px-3 flex items-center justify-between gap-2 text-sm">
                                                        <div className="min-w-0">
                                                            <div className="font-medium truncate">#{o.order_number} · {ORDER_STATUS_LABELS[o.status] || o.status}</div>
                                                            <AttentionReference order={o} branchNames={branchNames} />
                                                            <div className="text-xs text-muted-foreground">{fmtDateTime(o.created_at)}</div>
                                                        </div>
                                                        <span className="font-mono font-semibold tabular-nums shrink-0">{fmtMoney(o.total)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="border-t p-4 space-y-2">
                                    {t.active_order ? (
                                        <>
                                            {floor.key === 'listo' && canServe && (
                                                <Button className="w-full h-12" onClick={() => deliver(t.active_order.id)} data-testid="mesa-sheet-entregar">Entregar</Button>
                                            )}
                                            {closeable && (
                                                <Button variant="outline" className="w-full h-12" onClick={() => closeAttention(order)} disabled={closing === order.id} data-testid={`servicio-cerrar-sheet-${t.number}`}>
                                                    {closing === order.id ? 'Cerrando…' : 'Finalizar mesa'}
                                                </Button>
                                            )}
                                            {billRequested ? (
                                                <Button disabled variant="outline" className="w-full h-12" data-testid="mesa-sheet-cuenta-solicitada">
                                                    Cuenta solicitada
                                                </Button>
                                            ) : (
                                                ['listo', 'entregado'].includes(order?.status) && canTake && (
                                                    <Button variant="outline" className="w-full h-12" onClick={() => requestBill(order)} data-testid="mesa-sheet-solicitar-cuenta">
                                                        Solicitar cuenta
                                                    </Button>
                                                )
                                            )}
                                            <Button
                                                variant={floor.key === 'listo' ? 'outline' : 'default'}
                                                className="w-full h-12"
                                                onClick={() => { closeSheet(); navigate(`/pedidos/${t.active_order.id}`); }}
                                                data-testid="mesa-sheet-ver-pedido"
                                            >
                                                {floor.key === 'listo' ? 'Ver pedido' : 'Abrir pedido'}
                                            </Button>
                                        </>
                                    ) : t.status === 'pagada' ? (
                                        <Button className="w-full h-12" variant="outline" onClick={() => releaseTable(t)} disabled={!canTake} data-testid="mesa-sheet-liberar">
                                            Liberar mesa
                                        </Button>
                                    ) : t.status === 'disponible' ? (
                                        <Button className="w-full h-12" onClick={() => openAreas(t)} disabled={!canTake} data-testid="mesa-sheet-tomar">
                                            <Plus className="h-4 w-4 mr-1" /> Tomar mesa y pedir
                                        </Button>
                                    ) : t.status === 'ocupada' ? (
                                        <Button className="w-full h-12" onClick={() => openAreas(t)} disabled={!canTake} data-testid="mesa-sheet-tomar-pedido">
                                            Tomar pedido
                                        </Button>
                                    ) : null}
                                </div>
                            </>
                        );
                    })()}
                </SheetContent>
            </Sheet>

            {/* Sales areas — first decision of every order */}
            <Dialog open={showNewOrder} onOpenChange={(open) => (open ? setShowNewOrder(true) : closeAreas())}>
                <DialogContent className="sm:max-w-lg" data-testid="areas-venta">
                    <DialogHeader>
                        <DialogTitle className="font-display text-2xl">Áreas de venta</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {pendingTable && (
                            <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-testid="areas-venta-mesa">
                                Pedido para <strong>Mesa {pendingTable.number}</strong>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            {ORDER_AREAS.map((area) => (
                                <button
                                    key={area.key}
                                    type="button"
                                    onClick={() => chooseArea(area.key)}
                                    data-testid={`area-${area.key}`}
                                    className={`flex min-h-[96px] flex-col items-start justify-center gap-1 rounded-xl border-2 p-4 text-left transition-colors ${
                                        newOrderType === area.key
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border hover:border-primary hover:bg-primary/5'
                                    }`}
                                >
                                    <span className="font-display text-xl font-semibold">{ORDER_TYPE_LABELS[area.key]}</span>
                                    <span className="text-xs text-muted-foreground">{area.hint}</span>
                                </button>
                            ))}
                        </div>
                        {newOrderType === 'mesa' && !pendingTable && (
                            availableTables.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">No hay mesas disponibles en este momento.</p>
                            ) : (
                                <div className="grid grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto" data-testid="areas-venta-mesas">
                                    {availableTables.map((t) => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => goToOrder('mesa', t)}
                                            data-testid={`salon-mesa-disponible-${t.number}`}
                                            className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5 transition-colors"
                                        >
                                            <span className="font-display text-2xl font-bold">{t.number}</span>
                                            <span className="text-xs text-muted-foreground mt-1">{t.area}</span>
                                        </button>
                                    ))}
                                </div>
                            )
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={closeAreas} data-testid="areas-venta-cancelar">Cancelar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
