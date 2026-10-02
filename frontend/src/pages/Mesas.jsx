import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNavigate } from 'react-router-dom';
import { fmtMoney, fmtElapsed, fmtDateTime, ORDER_STATUS_LABELS } from '@/lib/format';
import { Search, Grid2X2, Plus, Users, ShoppingCart, Clock, UtensilsCrossed, Receipt, Bell } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { toast } from 'sonner';
import AttentionReference from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';

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

// Priority rank for table sorting — lower number = higher priority (appears first).
// Attention-needed states (listo, cuenta, atencion) are surfaced first so staff
// can locate them at a glance. Among equal priority, older orders rank higher.
function priorityRank(floorKey, order) {
    if (floorKey === 'cuenta') return 0;
    if (floorKey === 'listo') return 1;
    if (floorKey === 'atencion') return 2;
    if (floorKey === 'preparando') return 3;
    if (floorKey === 'entregado') return 4;
    if (floorKey === 'sentados') return 5;
    if (floorKey === 'libre') return 6;
    if (floorKey === 'reservada') return 7;
    if (floorKey === 'pagada') return 8;
    if (floorKey === 'inactiva') return 9;
    return 10;
}

function orderTimestamp(order) {
    if (!order?.created_at) return 0;
    const t = new Date(order.created_at).getTime();
    return Number.isFinite(t) ? t : 0;
}

export default function Mesas() {
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [openTable, setOpenTable] = useState(null);
    const [showNewOrder, setShowNewOrder] = useState(false);
    const [newOrderType, setNewOrderType] = useState('mesa');
    const [newOrderTable, setNewOrderTable] = useState('');

    const { generation } = useNotify();
    const { data: tables, refetch } = usePolling(
        () => api.get('/tables').then((r) => r.data),
        8000,
        [generation]
    );

    const areas = useMemo(() => {
        const s = new Set((tables || []).map((t) => t.area));
        return ['todas', ...Array.from(s)];
    }, [tables]);

    const filtered = useMemo(() => {
        const list = (tables || []).filter((t) => {
            if (areaFilter !== 'todas' && t.area !== areaFilter) return false;
            if (search && !`${t.number} ${t.name}`.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
        // Sort by priority (attention-needed first), then by oldest order timestamp.
        return list.slice().sort((a, b) => {
            const fa = floorState(a);
            const fb = floorState(b);
            const ra = priorityRank(fa.key, a.active_order);
            const rb = priorityRank(fb.key, b.active_order);
            if (ra !== rb) return ra - rb;
            // Among equal priority, older orders first (smaller timestamp = older).
            const ta = orderTimestamp(a.active_order);
            const tb = orderTimestamp(b.active_order);
            if (ta && tb) return ta - tb;
            if (ta) return -1;
            if (tb) return 1;
            return Number(a.number) - Number(b.number);
        });
    }, [tables, areaFilter, search]);

    const canServe = ['admin', 'mozo', 'cocina'].includes(user.role);
    const canTake = ['admin', 'mozo'].includes(user.role);

    const openOrderId = openTable?.order?.id || null;
    const { data: liveOrderData } = usePolling(
        () => (openOrderId ? api.get(`/orders/${openOrderId}`).then((r) => r.data) : Promise.resolve(null)),
        10000,
        [openOrderId]
    );
    const sheetOrder = openTable?.order && liveOrderData && liveOrderData.id === openTable.order.id
        ? liveOrderData
        : (openTable?.order || null);

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

    const deliver = async (orderId) => {
        try {
            await api.post(`/orders/${orderId}/serve`);
            toast.success('Pedido entregado');
            closeSheet();
            refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo entregar');
        }
    };

    const copyGuestLink = async (table) => {
        try {
            const { data } = await api.get(`/tables/${table.id}/guest-link`);
            await navigator.clipboard.writeText(`${window.location.origin}${data.path}`);
            toast.success(`QR de la mesa ${data.table_number} copiado`);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo copiar el QR');
        }
    };

    const rotateQr = async (table) => {
        try {
            const { data } = await api.post(`/tables/${table.id}/qr/rotate`);
            await navigator.clipboard.writeText(`${window.location.origin}${data.path}`);
            toast.success(`QR nuevo de la mesa ${data.table_number} copiado`);
            refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo regenerar el QR');
        }
    };

    const revokeQr = async (table) => {
        if (!window.confirm(`¿Revocar el QR de la mesa ${table.number}? El impreso dejará de funcionar.`)) return;
        try {
            await api.post(`/tables/${table.id}/qr/revoke`);
            toast.success(`QR de la mesa ${table.number} revocado`);
            refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo revocar el QR');
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
            refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo liberar');
        }
    };

    const startNewOrder = () => {
        if (newOrderType === 'mesa' && !newOrderTable) {
            toast.error('Seleccioná una mesa');
            return;
        }
        setShowNewOrder(false);
        if (newOrderType === 'mesa') {
            navigate(`/pedidos/nuevo?mesa=${newOrderTable}`);
        } else {
            navigate(`/pedidos/nuevo?tipo=${newOrderType}`);
        }
        setNewOrderType('mesa');
        setNewOrderTable('');
    };

    const availableTables = useMemo(() => {
        return (tables || []).filter((t) => 
            t.status === 'disponible' || t.status === 'ocupada'
        );
    }, [tables]);

    return (
        <div className="space-y-5" data-testid="mesas-root">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Salón</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Grid2X2 className="h-6 w-6 text-primary" /> Mesas</h1>
                    <p className="text-muted-foreground text-sm">Tocá una mesa para ver el detalle y actuar.</p>
                </div>
                <div className="flex gap-2 items-center">
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-48" placeholder="Buscar mesa" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="mesas-search-input" />
                    </div>
                    {canTake && (
                        <Button onClick={() => setShowNewOrder(true)} data-testid="mesas-nuevo-pedido">
                            <ShoppingCart className="h-4 w-4 mr-1" /> Nuevo pedido
                        </Button>
                    )}
                </div>
            </div>

            {/* Legend */}
            <div className="flex gap-2 items-center overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-testid="mesas-legend">
                <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2 shrink-0">Estados:</span>
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

            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                {areas.map((a) => (
                    <button
                        key={a}
                        onClick={() => setAreaFilter(a)}
                        data-testid={`mesas-area-${a}`}
                        className={`shrink-0 px-3 py-1.5 rounded-sm text-sm font-medium transition-colors border ${areaFilter === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {a === 'todas' ? 'Todas las zonas' : a}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground border rounded-xl">No hay mesas con esos filtros.</div>
            ) : (
                <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {filtered.map((t) => {
                        const floor = floorState(t);
                        const s = FLOOR_STYLE[floor.key];
                        const order = t.active_order;
                        const needsAttention = ['listo', 'cuenta', 'atencion'].includes(floor.key);
                        const elapsed = order?.created_at ? fmtElapsed(order.created_at) : null;
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
                                <div
                                    className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1 active:scale-[0.99] transition-transform"
                                >
                                    <div className="flex items-start justify-between gap-1">
                                        <div className="font-display text-3xl sm:text-4xl font-bold leading-none" style={{ color: s.fg }}>{t.number}</div>
                                        {needsAttention && (
                                            <span className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center" style={{ background: s.dot }} aria-label="Requiere atencion">
                                                <Bell className="h-3.5 w-3.5 text-white" />
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                                        <span className="text-sm font-semibold" style={{ color: s.fg }}>{s.label}</span>
                                    </div>
                                    {elapsed && floor.key !== 'libre' && floor.key !== 'pagada' && floor.key !== 'inactiva' && (
                                        <div className="flex items-center gap-1 text-xs" style={{ color: s.fg, opacity: 0.75 }}>
                                            <Clock className="h-3 w-3" />
                                            <span>Hace {elapsed}</span>
                                        </div>
                                    )}
                                    {order?.total != null && (
                                        <div className="text-xs font-mono font-semibold tabular-nums mt-auto" style={{ color: s.fg, opacity: 0.85 }}>{fmtMoney(order.total)}</div>
                                    )}
                                </div>
                                {floor.key === 'listo' && canServe && (
                                    <button
                                        type="button"
                                        className="mx-3 mb-3 sm:mx-4 sm:mb-4 h-9 rounded-lg text-sm font-semibold text-white transition-colors active:scale-[0.98]"
                                        style={{ background: s.dot }}
                                        onClick={(e) => { e.stopPropagation(); deliver(order.id); }}
                                        data-testid={`mesa-card-deliver-${t.number}`}
                                    >
                                        <UtensilsCrossed className="h-3.5 w-3.5 inline mr-1" /> Entregar
                                    </button>
                                )}
                                {floor.key === 'cuenta' && canServe && (
                                    <button
                                        type="button"
                                        className="mx-3 mb-3 sm:mx-4 sm:mb-4 h-9 rounded-lg text-sm font-semibold text-white transition-colors active:scale-[0.98]"
                                        style={{ background: s.dot }}
                                        onClick={(e) => { e.stopPropagation(); closeSheet(); navigate(`/pedidos/${order.id}`); }}
                                        data-testid={`mesa-card-cobrar-${t.number}`}
                                    >
                                        <Receipt className="h-3.5 w-3.5 inline mr-1" /> Cobrar
                                    </button>
                                )}
                                {floor.key === 'sentados' && canTake && (
                                    <button
                                        type="button"
                                        className="mx-3 mb-3 sm:mx-4 sm:mb-4 h-9 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]"
                                        style={{ background: s.border, color: s.fg }}
                                        onClick={(e) => { e.stopPropagation(); takeTable(t); }}
                                        data-testid={`mesa-card-pedir-${t.number}`}
                                    >
                                        Tomar pedido
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Sheet open={Boolean(openTable)} onOpenChange={(o) => { if (!o) closeSheet(); }}>
                <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-testid="mesa-sheet">
                    {openTable && (() => {
                        const { table: t, history, loading } = openTable;
                        const order = sheetOrder;
                        const floor = floorState(t);
                        const s = FLOOR_STYLE[floor.key];
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
                                    {!t.active_order && (
                                        <p className="text-sm text-muted-foreground">Sin pedido activo en esta mesa.</p>
                                    )}
                                    {t.active_attention_id && order && (
                                        <p className="text-sm text-muted-foreground">La visita sigue abierta. Finalizala en Servicio cuando el cobro y la entrega estén completos.</p>
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
                                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                        <span>
                                            QR: {t.qr_status === 'active' ? 'activo' : t.qr_status === 'revoked' ? 'revocado' : 'sin generar'}
                                        </span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="w-full h-11"
                                        onClick={() => copyGuestLink(t)}
                                        disabled={t.qr_status === 'revoked'}
                                        data-testid="mesa-sheet-qr"
                                    >
                                        Copiar QR de la mesa
                                    </Button>
                                    {user.role === 'admin' && (
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                className="flex-1 h-10"
                                                onClick={() => rotateQr(t)}
                                                data-testid="mesa-sheet-qr-rotate"
                                            >
                                                Regenerar QR
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="flex-1 h-10 text-destructive"
                                                onClick={() => revokeQr(t)}
                                                disabled={t.qr_status === 'revoked'}
                                                data-testid="mesa-sheet-qr-revoke"
                                            >
                                                Revocar
                                            </Button>
                                        </div>
                                    )}
                                    {t.active_order ? (
                                        <>
                                            {floor.key === 'listo' && canServe && (
                                                <Button className="w-full h-12" onClick={() => deliver(t.active_order.id)} data-testid="mesa-sheet-entregar">Entregar</Button>
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
                                        <Button className="w-full h-12" onClick={() => takeTable(t)} disabled={!canTake} data-testid="mesa-sheet-tomar">
                                            <Plus className="h-4 w-4 mr-1" /> Tomar mesa y pedir
                                        </Button>
                                    ) : t.status === 'ocupada' ? (
                                        <Button className="w-full h-12" onClick={() => takeTable(t)} disabled={!canTake} data-testid="mesa-sheet-tomar-pedido">
                                            Tomar pedido
                                        </Button>
                                    ) : null}
                                </div>
                            </>
                        );
                    })()}
                </SheetContent>
            </Sheet>

            <Dialog open={showNewOrder} onOpenChange={setShowNewOrder}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Nuevo pedido</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Tipo de pedido</label>
                            <Select value={newOrderType} onValueChange={setNewOrderType}>
                                <SelectTrigger data-testid="nuevo-pedido-tipo">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="mesa">Mesa</SelectItem>
                                    <SelectItem value="delivery">Delivery</SelectItem>
                                    <SelectItem value="recojo">Recojo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {newOrderType === 'mesa' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Seleccioná una mesa</label>
                                <Select value={newOrderTable} onValueChange={setNewOrderTable}>
                                    <SelectTrigger data-testid="nuevo-pedido-mesa">
                                        <SelectValue placeholder="Elegir mesa..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableTables.map((t) => (
                                            <SelectItem key={t.id} value={t.id}>
                                                Mesa {t.number} · {t.area} {t.status === 'ocupada' ? '(ocupada)' : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Podés crear el pedido desde donde estés, sin necesidad de ir a la mesa.
                                </p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewOrder(false)}>Cancelar</Button>
                        <Button onClick={startNewOrder} data-testid="nuevo-pedido-crear">
                            Crear pedido
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
