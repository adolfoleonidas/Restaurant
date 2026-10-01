import React, { useMemo, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useNavigate } from 'react-router-dom';
import { fmtMoney, fmtElapsed, fmtDateTime, ORDER_STATUS_LABELS } from '@/lib/format';
import { Search, Grid2X2, Plus, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { toast } from 'sonner';

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

export default function Mesas() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [openTable, setOpenTable] = useState(null);

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
        return (tables || []).filter((t) => {
            if (areaFilter !== 'todas' && t.area !== areaFilter) return false;
            if (search && !`${t.number} ${t.name}`.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
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

    return (
        <div className="space-y-5" data-testid="mesas-root">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Salón</p>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Grid2X2 className="h-6 w-6 text-primary" /> Mesas</h1>
                    <p className="text-muted-foreground text-sm">Tocá una mesa para ver el detalle y actuar.</p>
                </div>
                <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                    <Input className="pl-9 h-10 w-48" placeholder="Buscar mesa" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="mesas-search-input" />
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
                        return (
                            <button
                                key={t.id}
                                type="button"
                                data-testid={`mesa-card-${t.number}`}
                                onClick={() => openSheet(t)}
                                className="cursor-pointer rounded-xl border-2 p-4 flex flex-col gap-2 text-left active:scale-[0.99] transition-transform"
                                style={{ background: s.bg, borderColor: s.border }}
                            >
                                <div className="font-display italic text-4xl font-bold leading-none" style={{ color: s.fg }}>{t.number}</div>
                                <div className="flex items-center gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                                    <span className="text-sm font-semibold" style={{ color: s.fg }}>{s.label}</span>
                                </div>
                                {t.active_order?.total != null && (
                                    <div className="text-xs font-mono font-semibold tabular-nums mt-auto" style={{ color: s.fg, opacity: 0.85 }}>{fmtMoney(t.active_order.total)}</div>
                                )}
                            </button>
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
                                        <h2 className="font-display italic text-2xl font-semibold" style={{ color: s.fg }}>{s.label}</h2>
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
        </div>
    );
}
