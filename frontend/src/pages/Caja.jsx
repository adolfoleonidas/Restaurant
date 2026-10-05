import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtTime, fmtDateTime, PAYMENT_LABELS, ORDER_TYPE_LABELS } from '@/lib/format';
import { Wallet, DollarSign, PlusCircle, MinusCircle, LockOpen, Lock, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useNotify } from '@/contexts/NotifyContext';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { printCajaReceipt } from '@/lib/printReceipt';
import { accountLabel, round2 } from '@/lib/cash';
import CobrarDialog from '@/components/CobrarDialog';
import AccountPaymentAudit from '@/components/AccountPaymentAudit';

function WebOrderRow({ order, onConfirm, scopeParams = {} }) {
    const [proof, setProof] = useState(null);
    const [showProof, setShowProof] = useState(false);
    const [loading, setLoading] = useState(false);

    const openProof = async () => {
        setLoading(true);
        try {
            const options = Object.keys(scopeParams).length ? { params: scopeParams } : undefined;
            const { data } = await api.get(`/orders/${order.id}`, options);
            setProof(data.payment_proof_url || null);
            setShowProof(true);
        } catch (e) {
            toast.error('No se pudo cargar el comprobante');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="py-3 flex items-start justify-between gap-3" data-testid={`caja-web-${order.order_number}`}>
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-lg font-bold">#{order.order_number}</span>
                    <StateBadge status={order.status} type="order" />
                    <span className="text-xs text-muted-foreground">{ORDER_TYPE_LABELS[order.order_type] || order.order_type}</span>
                </div>
                <div className="text-sm truncate">{order.customer_name || 'Cliente web'} · {order.customer_phone || '—'}</div>
                <div className="text-xs text-muted-foreground">
                    {PAYMENT_LABELS[order.payment_method_choice] || 'Pago'} · {order.payment_status === 'comprobante_subido' ? 'Comprobante subido' : 'Sin comprobante'}
                </div>
                {showProof && (
                    proof ? (
                        <img src={proof} alt="Comprobante" className="mt-2 max-h-40 rounded-sm border" />
                    ) : (
                        <div className="mt-2 text-xs text-muted-foreground">No hay imagen de comprobante.</div>
                    )
                )}
            </div>
            <div className="text-right shrink-0 space-y-1">
                <div className="font-mono font-bold tabular-nums">{fmtMoney(order.total)}</div>
                <Button size="sm" variant="outline" className="h-11 w-full" onClick={openProof} disabled={loading}>Ver comprobante</Button>
                <Button size="sm" className="h-11 w-full" onClick={onConfirm} data-testid={`caja-confirmar-web-${order.order_number}`}>Confirmar</Button>
            </div>
        </div>
    );
}

function PaymentHistory({ refreshKey, scopeParams = {}, runMutation }) {
    const { user } = useAuth();
    const scopeOptions = useCallback(() => Object.keys(scopeParams).length ? { params: scopeParams } : undefined, [scopeParams]);
    const canVoid = user?.role === 'admin' || !!user?.can_void;
    const [period, setPeriod] = useState('day');
    const [q, setQ] = useState('');
    const [items, setItems] = useState(null);
    const [detail, setDetail] = useState(null);
    const [voidKind, setVoidKind] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        const params = { period, limit: 200, ...scopeParams };
        if (q.trim()) params.q = q.trim();
        api.get('/payments', { params }).then((r) => setItems(r.data)).catch(() => setItems([]));
    }, [period, q, refreshKey, reload, scopeParams]);

    const reprint = async (p) => {
        let order = null;
        try {
            const { data } = await api.get(`/orders/${p.order_id}`, scopeOptions());
            order = data;
        } catch { /* payment still reprints from its own lines */ }
        const ok = printCajaReceipt({
            restaurantName: 'Sabor Peruano',
            label: order ? accountLabel(order) : `Pedido #${p.order_number}`,
            order: order || { order_number: p.order_number, items: [] },
            payment: p,
            items: (p.lines || []).length
                ? p.lines.map((l) => ({ product_name: l.name, quantity: l.quantity, unit_price: 0, pay_qty: l.quantity }))
                : order?.items,
        });
        if (!ok) toast.error('El navegador bloqueó la ventana. Permití popups para imprimir.');
    };

    const submitVoid = async () => {
        if (!detail || !voidKind) return;
        if ((voidReason || '').trim().length < 5) {
            toast.error('El motivo es obligatorio.');
            return;
        }
        try {
            await runMutation(async () => {
                if (canVoid) {
                    const { data } = await api.post(`/payments/${detail.id}/void`, { kind: voidKind, reason: voidReason.trim() });
                    toast.success(voidKind === 'refund' ? 'Devolución registrada. El cobro sigue en el historial.' : 'Anulación registrada. El cobro no se eliminó.');
                    setDetail(data);
                } else {
                    await api.post('/approvals', { kind: voidKind, reason: voidReason.trim(), payment_id: detail.id });
                    toast.success('Solicitud enviada al encargado. No cobres de nuevo mientras tanto.');
                    setDetail(null);
                }
            });
            setVoidKind(null);
            setVoidReason('');
            setReload((n) => n + 1);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo registrar');
        }
    };

    const statusLabel = (p) => {
        if (p.status === 'voided') return 'Anulado';
        if (p.status === 'refunded') return 'Devuelto';
        return null;
    };

    // Compute method totals and status grouping
    const methodTotals = useMemo(() => {
        if (!items) return {};
        const map = {};
        for (const p of items) {
            if (p.status === 'completed') {
                const key = p.method;
                map[key] = (map[key] || 0) + Number(p.amount || 0);
            }
        }
        return map;
    }, [items]);

    const statusGroups = useMemo(() => {
        if (!items) return { completed: [], voided: [], other: [] };
        const completed = [];
        const voided = [];
        const other = [];
        for (const p of items) {
            if (p.status === 'voided' || p.status === 'refunded') voided.push(p);
            else if (p.status === 'completed') completed.push(p);
            else other.push(p);
        }
        return { completed, voided, other };
    }, [items]);

    return (
        <Card data-testid="caja-historial-pagos">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-display text-lg font-semibold">Pagos registrados</h2>
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day">Hoy</TabsTrigger>
                            <TabsTrigger value="week">Semana</TabsTrigger>
                            <TabsTrigger value="month">Mes</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                {/* Method totals summary */}
                {items && Object.keys(methodTotals).length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-lg border border-border p-3" data-testid="caja-pago-method-totals">
                        {Object.entries(methodTotals).map(([method, total]) => (
                            <div key={method} className="text-sm">
                                <div className="text-xs text-muted-foreground">{PAYMENT_LABELS[method] || method}</div>
                                <div className="font-mono font-semibold tabular-nums">{fmtMoney(total)}</div>
                            </div>
                        ))}
                    </div>
                )}

                <Input className="h-11" placeholder="Buscar #pedido, método o cajero" value={q} onChange={(e) => setQ(e.target.value)} data-testid="caja-hist-pagos-buscar" />
                {!items ? (
                    <div className="text-sm text-muted-foreground">Cargando pagos…</div>
                ) : items.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No hay pagos en este período.</div>
                ) : (
                    <div className="divide-y border border-border rounded-sm">
                        {items.map((p) => {
                            const isVoided = p.status === 'voided' || p.status === 'refunded';
                            return (
                                <div key={p.id} className={`px-3 py-2 flex items-center justify-between gap-3 text-sm ${isVoided ? 'caja-pago-voided opacity-60' : ''}`} data-testid={`caja-pago-${p.id}`}>
                                    <button type="button" className="text-left min-w-0" onClick={() => setDetail(p)}>
                                        <div className="font-medium">
                                            Pedido #{p.order_number} · {PAYMENT_LABELS[p.method] || p.method}
                                            {statusLabel(p) ? ` · ${statusLabel(p)}` : ''}
                                        </div>
                                        <div className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)} · {p.paid_by_name}</div>
                                    </button>
                                    <div className="text-right shrink-0 space-y-1">
                                        <div className={`font-mono font-semibold tabular-nums ${isVoided ? 'line-through text-muted-foreground' : ''}`}>{fmtMoney(p.amount)}</div>
                                        <Button size="sm" variant="outline" className="h-8" onClick={() => reprint(p)} data-testid={`caja-reimprimir-${p.id}`}>
                                            <Printer className="h-3.5 w-3.5 mr-1" />Comprobante
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Pago · Pedido #{detail?.order_number}</DialogTitle></DialogHeader>
                        {detail && (
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between"><span>Método</span><span>{PAYMENT_LABELS[detail.method] || detail.method}</span></div>
                                <div className="flex justify-between"><span>Importe</span><span className="font-mono">{fmtMoney(detail.amount)}</span></div>
                                {detail.change_amount > 0 && <div className="flex justify-between"><span>Vuelto</span><span className="font-mono">{fmtMoney(detail.change_amount)}</span></div>}
                                <div className="flex justify-between"><span>Cajero</span><span>{detail.paid_by_name}</span></div>
                                <div className="flex justify-between"><span>Hora</span><span>{fmtDateTime(detail.created_at)}</span></div>
                                {detail.status && detail.status !== 'completed' && (
                                    <div className="rounded-xl border border-border p-3 text-sm">
                                        {statusLabel(detail)} · {detail.void_reason} · {detail.voided_by_name}
                                    </div>
                                )}
                                {(detail.lines || []).length > 0 && (
                                    <div className="border-t pt-2 space-y-1">
                                        {detail.lines.map((l, i) => (
                                            <div key={i} className="flex justify-between"><span>{l.quantity}× {l.name}</span></div>
                                        ))}
                                    </div>
                                )}
                                {detail.status === 'completed' && !voidKind && (
                                    <div className="flex gap-2 pt-2">
                                        <Button variant="outline" className="flex-1" onClick={() => setVoidKind('void')} data-testid="caja-anular">{canVoid ? 'Anular cobro' : 'Solicitar anulación'}</Button>
                                        <Button variant="outline" className="flex-1" onClick={() => setVoidKind('refund')} data-testid="caja-devolver">{canVoid ? 'Devolver dinero' : 'Solicitar devolución'}</Button>
                                    </div>
                                )}
                                {voidKind && (
                                    <div className="space-y-2 pt-2">
                                        <p className="text-xs text-muted-foreground">
                                            {voidKind === 'refund'
                                                ? 'Devolución: el cliente recibe el dinero. El cobro queda registrado como devuelto, no se borra.'
                                                : 'Anulación: corrección de un cobro mal registrado. El cobro queda en el historial, no se elimina.'}
                                        </p>
                                        <Label>Motivo</Label>
                                        <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} data-testid="caja-anular-motivo" />
                                        <div className="flex gap-2">
                                            <Button variant="outline" onClick={() => { setVoidKind(null); setVoidReason(''); }}>Cancelar</Button>
                                            <Button onClick={submitVoid} data-testid="caja-anular-confirmar">Registrar</Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        <DialogFooter>
                            <Button variant="outline" onClick={() => { setDetail(null); setVoidKind(null); }}>Cerrar</Button>
                            {detail?.status === 'completed' && <Button onClick={() => reprint(detail)}>Reimprimir</Button>}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}

function SoldDishes({ refreshKey, scopeParams = {}, contextKey = 'staff', branchName = null }) {
    const [period, setPeriod] = useState('day');
    const [result, setResult] = useState(null);
    const requestIdentity = JSON.stringify([contextKey, period, refreshKey, scopeParams]);
    const currentResult = result?.identity === requestIdentity ? result : null;
    const data = currentResult?.data || null;
    const failed = currentResult?.failed || false;

    useEffect(() => {
        let active = true;
        api.get('/reports/products', { params: { period, ...scopeParams } }).then((r) => {
            if (active) setResult({ identity: requestIdentity, data: r.data, failed: false });
        }).catch(() => {
            if (active) setResult({ identity: requestIdentity, data: null, failed: true });
        });
        return () => { active = false; };
    }, [period, refreshKey, scopeParams, contextKey, requestIdentity]);

    return (
        <Card data-testid="caja-historial-platos">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-display text-lg font-semibold">Platos vendidos</h2>
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day">Hoy</TabsTrigger>
                            <TabsTrigger value="week">Semana</TabsTrigger>
                            <TabsTrigger value="month">Mes</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
                {scopeParams.branch_id && branchName && <p className="text-xs text-muted-foreground">Reporte de platos para la sucursal {branchName}.</p>}
                {scopeParams.legacy_only && <p className="text-xs text-muted-foreground">Reporte de platos de registros históricos sin sucursal.</p>}
                {data && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-xs text-muted-foreground">Unidades</div>
                            <div className="font-mono font-semibold tabular-nums">{data.total_units || 0}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Importe de platos</div>
                            <div className="font-mono font-semibold tabular-nums">{fmtMoney(data.total_revenue)}</div>
                        </div>
                    </div>
                )}
                {failed ? (
                    <div role="alert" className="text-sm text-destructive">No se pudo cargar el reporte de platos para este contexto.</div>
                ) : !data ? (
                    <div className="text-sm text-muted-foreground">Cargando platos…</div>
                ) : !(data.products || []).length ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">Todavía no hay platos cobrados en este período.</div>
                ) : (
                    <div className="divide-y border border-border rounded-sm">
                        {data.products.map((p) => (
                            <div key={p.product_id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm" data-testid={`caja-plato-${p.product_id}`}>
                                <div className="font-medium">{p.name}</div>
                                <div className="text-right">
                                    <div className="font-mono font-semibold tabular-nums">{p.quantity} u.</div>
                                    <div className="text-xs text-muted-foreground">{fmtMoney(p.revenue)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function CashHistory({ refreshKey, scopeParams = {} }) {
    const [period, setPeriod] = useState('day');
    const [data, setData] = useState(null);

    useEffect(() => {
        api.get('/cash/history', { params: { period, ...scopeParams } }).then((r) => setData(r.data)).catch(() => setData({ registers: [] }));
    }, [period, refreshKey, scopeParams]);

    const grouped = useMemo(() => {
        const map = {};
        for (const r of data?.registers || []) {
            const key = r.opened_at
                ? new Date(r.opened_at).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' })
                : '—';
            if (!map[key]) map[key] = [];
            map[key].push(r);
        }
        return Object.entries(map);
    }, [data]);

    return (
        <Card data-testid="caja-historial">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-display text-lg font-semibold">Historial de turnos</h2>
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day" data-testid="caja-hist-day">Hoy</TabsTrigger>
                            <TabsTrigger value="week" data-testid="caja-hist-week">Semana</TabsTrigger>
                            <TabsTrigger value="month" data-testid="caja-hist-month">Mes</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
                {data && (
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <div className="text-xs text-muted-foreground">Turnos</div>
                            <div className="font-mono font-semibold tabular-nums">{data.sessions}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Ventas cerradas</div>
                            <div className="font-mono font-semibold tabular-nums text-primary">{fmtMoney(data.total_sales)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Diferencia</div>
                            <div className={`font-mono font-semibold tabular-nums ${Number(data.difference) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(data.difference)}</div>
                        </div>
                    </div>
                )}
                {!data ? (
                    <div className="text-sm text-muted-foreground">Cargando historial…</div>
                ) : grouped.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No hay turnos en este período.</div>
                ) : (
                    <div className="space-y-4">
                        {grouped.map(([day, regs]) => (
                            <div key={day}>
                                <div className="page-kicker mb-2">{day}</div>
                                <div className="divide-y border border-border rounded-sm">
                                    {regs.map((r) => (
                                        <div key={r.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm" data-testid={`caja-hist-${r.id}`}>
                                            <div>
                                                <div className="font-medium">
                                                    {fmtDateTime(r.opened_at)}
                                                    {r.closed_at ? ` → ${fmtTime(r.closed_at)}` : ' · abierta'}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {r.opened_by_name}
                                                    {r.status === 'closed' ? ` · cierre ${fmtMoney(r.closing_amount)}` : ''}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono font-semibold tabular-nums">{fmtMoney(r.total_sales || 0)}</div>
                                                {r.status === 'closed' && (
                                                    <div className={`text-xs ${Number(r.difference) < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                                        Δ {fmtMoney(r.difference)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function OpenCajaCard({ onOpened, branchId, canOpen = true, runMutation }) {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const open = async () => {
        if (!amount) { toast.error('Indica monto inicial'); return; }
        setLoading(true);
        try {
            await runMutation(() => api.post('/cash/open', {
                opening_amount: Number(amount), notes,
                ...(branchId ? { branch_id: branchId } : {}),
            }));
            toast.success('Caja abierta');
            onOpened && onOpened();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo completar la operación. Revisá tu conexión y reintentá.'); }
        finally { setLoading(false); }
    };
    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><LockOpen className="h-5 w-5 text-primary" /><h2 className="font-display text-xl font-semibold">Apertura de caja</h2></div>
            <p className="text-sm text-muted-foreground mb-3">Registra el monto inicial en efectivo en la caja para empezar el turno.</p>
            <div className="grid sm:grid-cols-2 gap-3">
                <div><Label>Monto inicial (S/)</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11" data-testid="caja-apertura-monto" /></div>
                <div><Label>Notas (opcional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11" /></div>
            </div>
            <Button onClick={open} disabled={loading || !canOpen} className="mt-4 h-11" data-testid="caja-apertura-submit"><LockOpen className="h-4 w-4 mr-2" /> Abrir caja</Button>
        </CardContent></Card>
    );
}

function CloseCajaDialog({ open, onOpenChange, register, onClosed, runMutation }) {
    const [closing, setClosing] = useState('');
    const [notes, setNotes] = useState('');
    React.useEffect(() => {
        if (open) { setClosing(''); setNotes(''); }
    }, [open, register?.id]);
    if (!register) return null;
    const expected = Number(register.expected_amount || 0);
    const counted = closing === '' ? null : Number(closing);
    const diff = counted == null || Number.isNaN(counted) ? null : round2(counted - expected);
    const by = register.by_method || {};
    const digital = ['yape', 'plin', 'tarjeta', 'transferencia'].filter((m) => Number(by[m] || 0) > 0);
    const submit = async () => {
        if (closing === '' || Number.isNaN(Number(closing))) { toast.error('Indicá el efectivo contado'); return; }
        try {
            const { data } = await runMutation(() => api.post('/cash/close', { closing_amount: Number(closing), notes }));
            const delta = Number(data.difference || 0);
            toast.success(delta === 0 ? 'Turno cerrado. El cajón cuadra.' : `Turno cerrado. Diferencia: ${fmtMoney(delta)}`);
            onClosed && onClosed();
            onOpenChange(false);
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo completar la operación. Revisá tu conexión y reintentá.'); }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md" data-testid="caja-cierre-dialog">
                <DialogHeader><DialogTitle>Cerrar turno</DialogTitle></DialogHeader>
                <div className="space-y-3">
                    <div className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1" data-testid="caja-cierre-resumen">
                        <div className="flex justify-between"><span>Fondo inicial</span><span className="font-mono tabular-nums">{fmtMoney(register.opening_amount)}</span></div>
                        <div className="flex justify-between"><span>Cobros netos en efectivo</span><span className="font-mono tabular-nums">{fmtMoney(register.cash_sales)}</span></div>
                        <div className="flex justify-between"><span>Ingresos</span><span className="font-mono tabular-nums">{fmtMoney(register.income)}</span></div>
                        <div className="flex justify-between"><span>Retiros</span><span className="font-mono tabular-nums">- {fmtMoney(register.expense)}</span></div>
                        <div className="border-t pt-2 flex justify-between font-semibold"><span>Efectivo esperado</span><span className="font-mono tabular-nums" data-testid="caja-cierre-esperado">{fmtMoney(expected)}</span></div>
                    </div>
                    {digital.length > 0 && (
                        <div className="rounded-xl border border-border p-3 text-sm space-y-1">
                            <div className="text-xs text-muted-foreground">No van al cajón</div>
                            {digital.map((m) => (
                                <div key={m} className="flex justify-between"><span>{PAYMENT_LABELS[m]}</span><span className="font-mono tabular-nums">{fmtMoney(by[m])}</span></div>
                            ))}
                        </div>
                    )}
                    <div>
                        <Label>Efectivo contado (S/)</Label>
                        <Input type="number" min="0" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)} className="h-11" data-testid="caja-cierre-monto" />
                    </div>
                    {diff != null && (
                        <div className={`rounded-xl p-3 ${diff < 0 ? 'bg-destructive/10' : 'bg-primary/10'}`} data-testid="caja-cierre-diferencia">
                            <div className="text-xs text-muted-foreground">{diff < 0 ? 'Faltan' : diff > 0 ? 'Sobra' : 'Cuadra'}</div>
                            <div className="font-display text-2xl font-semibold tabular-nums">{fmtMoney(Math.abs(diff))}</div>
                        </div>
                    )}
                    <div><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={submit} data-testid="caja-cierre-submit">Cerrar turno</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MovementCard({ register, onAdded, runMutation }) {
    const [type, setType] = useState('ingreso');
    const [amount, setAmount] = useState('');
    const [desc, setDesc] = useState('');
    const submit = async () => {
        if (!amount || !desc) { toast.error('Completa los campos'); return; }
        try {
            await runMutation(() => api.post('/cash/movements', { type, amount: Number(amount), description: desc }));
            toast.success('Movimiento registrado');
            setAmount(''); setDesc('');
            onAdded && onAdded();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo completar la operación. Revisá tu conexión y reintentá.'); }
    };
    return (
        <Card><CardContent className="p-5">
            <h2 className="font-display text-lg font-semibold mb-3">Movimientos de caja</h2>
            <div className="grid sm:grid-cols-4 gap-2">
                <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ingreso">Ingreso</SelectItem>
                        <SelectItem value="egreso">Egreso</SelectItem>
                    </SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="caja-mov-monto" />
                <Input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} className="sm:col-span-1" data-testid="caja-mov-desc" />
                <Button onClick={submit} data-testid="caja-mov-submit">{type === 'ingreso' ? <PlusCircle className="h-4 w-4 mr-1" /> : <MinusCircle className="h-4 w-4 mr-1" />} Registrar</Button>
            </div>
            {(register.movements || []).length > 0 && (
                <div className="mt-4 divide-y">
                    {register.movements.map((m) => (
                        <div key={m.id} className="py-2 flex items-center justify-between text-sm">
                            <div>
                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${m.type === 'ingreso' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                <span className="text-muted-foreground">{fmtTime(m.created_at)}</span> · {m.description}
                            </div>
                            <span className={`font-semibold tabular-nums ${m.type === 'ingreso' ? 'text-emerald-700' : 'text-rose-700'}`}>{m.type === 'ingreso' ? '+' : '-'}{fmtMoney(m.amount)}</span>
                        </div>
                    ))}
                </div>
            )}
        </CardContent></Card>
    );
}

function CajaWorkspace({ ownerContext = false, contextKey = 'staff', scopeParams = {}, selectedBranchId = null, branches = [], canOpen = true, runMutation, onCollectionChange }) {
    const [params] = useSearchParams();
    const [pendingOrder, setPendingOrder] = useState(null);
    const [closeDialog, setCloseDialog] = useState(false);
    const [tab, setTab] = useState('cobrar');
    const [histKind, setHistKind] = useState('pagos');
    const [query, setQuery] = useState('');

    const { generation } = useNotify();
    const scopeOptions = useCallback((baseParams = {}) => {
        const params = { ...baseParams, ...scopeParams };
        return Object.keys(params).length ? { params } : undefined;
    }, [scopeParams]);
    const scopedGet = useCallback((path, baseParams) => {
        const options = scopeOptions(baseParams);
        return options ? api.get(path, options) : api.get(path);
    }, [scopeOptions]);
    const { data: register, loading, refetch: refetchReg } = usePolling(
        () => scopedGet('/cash/current').then((r) => r.data), 12000, [generation, contextKey]
    );
    const { data: pending, refetch: refetchPending } = usePolling(
        () => scopedGet('/orders', { active_only: true }).then((r) => r.data),
        12000,
        [generation, contextKey]
    );
    const { data: tables } = usePolling(() => scopedGet('/tables').then((r) => r.data), 20000, [generation, contextKey]);

    const selectOrder = useCallback((order) => {
        setPendingOrder(order);
        onCollectionChange?.(!!order);
    }, [onCollectionChange]);
    const closeCollection = useCallback(() => {
        setPendingOrder(null);
        onCollectionChange?.(false);
    }, [onCollectionChange]);

    useEffect(() => {
        const id = params.get('order');
        if (!id || !pending) return;
        const hit = pending.find((o) => o.id === id);
        if (hit) selectOrder(hit);
    }, [params, pending, selectOrder]);

    const cobrables = useMemo(() => {
        // Un pedido web con comprobante ya subido se resuelve en su propio bloque
        // (Ver comprobante / Confirmar). Se excluye de las listas de cobro para que
        // una misma cuenta no ofrezca dos acciones de dinero a la vez.
        const list = (pending || []).filter((o) => o.status !== 'pagado' && o.status !== 'cancelado' && o.payment_status !== 'comprobante_subido');
        const requested = list.filter((o) => o.payment_requested || o.status === 'pendiente_pago');
        const rest = list.filter((o) => !(o.payment_requested || o.status === 'pendiente_pago'));
        return [...requested, ...rest].map((o) => ({
            ...o,
            table_number: (tables || []).find((t) => t.id === o.table_id)?.number,
        }));
    }, [pending, tables]);

    const requestedBills = useMemo(() => cobrables.filter((o) => o.payment_requested || o.status === 'pendiente_pago'), [cobrables]);
    const otherBills = useMemo(() => cobrables.filter((o) => !(o.payment_requested || o.status === 'pendiente_pago')), [cobrables]);

    const matchQ = (o) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return `${o.order_number} ${o.customer_name || ''} ${o.table_id || ''} ${accountLabel(o)}`.toLowerCase().includes(q);
    };

    const webPending = useMemo(() =>
        (pending || []).filter((o) =>
            o.source === 'public'
            && o.status !== 'pagado'
            && o.status !== 'cancelado'
            && o.payment_status !== 'confirmado'
        )
    , [pending]);

    const confirmWeb = async (order) => {
        try {
            await runMutation(() => api.post(`/orders/${order.id}/confirm-payment`));
            toast.success(`Pedido #${order.order_number}: pago web confirmado`);
            refetchPending();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo confirmar');
        }
    };

    if (loading && register == null) {
        return (
            <div className="space-y-5" data-testid="caja-root">
                <div>
                    <p className="page-kicker mb-1">Caja</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
                </div>
                <p className="text-sm text-muted-foreground">Cargando caja…</p>
            </div>
        );
    }

    if (!register) return (
        <div className="space-y-4" data-testid="caja-root">
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
                {ownerContext && scopeParams.legacy_only ? (
                    <p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">No hay una caja histórica abierta</p>
                ) : <OpenCajaCard onOpened={refetchReg} branchId={selectedBranchId} canOpen={canOpen} runMutation={runMutation} />}
            {cobrables.length > 0 && (
                <Card data-testid="caja-cuentas-cerradas">
                    <CardContent className="p-4">
                        <h2 className="font-display text-lg font-semibold mb-1">Cuentas esperando tu turno ({cobrables.length})</h2>
                        <p className="text-xs text-muted-foreground mb-3">Abrí la caja para cobrarlas.</p>
                        <div className="divide-y opacity-70">
                            {cobrables.slice(0, 8).map((o) => (
                                <div key={o.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-display font-bold truncate">{accountLabel(o)}</span>
                                        {(o.payment_requested || o.status === 'pendiente_pago') && <span className="text-xs text-primary shrink-0">Cuenta solicitada</span>}
                                    </div>
                                    <span className="font-mono font-semibold tabular-nums shrink-0">{fmtMoney(o.total)}</span>
                                </div>
                            ))}
                        </div>
                        {cobrables.length > 8 && <div className="text-xs text-muted-foreground mt-2">y {cobrables.length - 8} más…</div>}
                    </CardContent>
                </Card>
            )}
            <CashHistory refreshKey={contextKey} scopeParams={scopeParams} />
        </div>
    );

    return (
        <div className="space-y-5" data-testid="caja-root">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
                    <p className="text-muted-foreground text-sm">Turno de {register.opened_by_name} · {fmtDateTime(register.opened_at)}</p>
                </div>
                <div className="flex gap-2">
                    {['cobrar', 'historial', 'turno'].map((k) => (
                <Button key={k} variant={tab === k ? 'default' : 'outline'} className="h-11" onClick={() => setTab(k)}>
                            {k === 'cobrar' ? 'Cobrar' : k === 'historial' ? 'Historial' : 'Mi turno'}
                        </Button>
                    ))}
                </div>
            </div>

            <Card><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div><div className="text-xs text-muted-foreground">Monto inicial</div><div className="font-display text-xl font-semibold tabular-nums">{fmtMoney(register.opening_amount)}</div></div>
                <div><div className="text-xs text-muted-foreground">Caja</div><StateBadge status={register.status === 'open' ? 'disponible' : 'inactiva'} type="table" /></div>
            </CardContent></Card>

            {tab === 'cobrar' && (
            <>
            {webPending.length > 0 && (
                <Card><CardContent className="p-4">
                    <h2 className="font-display text-lg font-semibold mb-3">Pedidos web ({webPending.length})</h2>
                    <div className="divide-y">
                        {webPending.map((o) => (
                            <WebOrderRow key={o.id} order={o} scopeParams={scopeParams} onConfirm={() => confirmWeb(o)} />
                        ))}
                    </div>
                </CardContent></Card>
            )}

            {cobrables.length > 0 && (
                <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-3.5 text-muted-foreground" />
                    <Input className="pl-9 h-11 sm:max-w-xs" placeholder="Buscar mesa, cliente o #pedido" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="caja-buscar" />
                </div>
            )}

            {requestedBills.length > 0 && (
                <Card className="border-primary/40"><CardContent className="p-4">
                    <h2 className="font-display text-lg font-semibold mb-3">Cuentas solicitadas ({requestedBills.length})</h2>
                    <div className="divide-y">
                        {requestedBills.filter(matchQ).map((o) => (
                            <div key={o.id} className="py-3 flex items-center justify-between gap-3" data-testid={`caja-pedido-${o.order_number}`}>
                                <div className="min-w-0">
                                    <div className="font-display text-lg font-bold truncate">{accountLabel(o)}</div>
                                    <div className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · {(o.items || []).length} ítems</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</div>
                                    {o.payment_status === 'pagado' ? <div className="text-xs text-primary mt-1">Pagado · sigue en cocina</div> : <Button size="sm" className="mt-1 h-10" onClick={() => selectOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>}
                                    <AccountPaymentAudit order={o} scopeParams={scopeParams} />
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent></Card>
            )}

            <Card><CardContent className="p-4">
                <h2 className="font-display text-lg font-semibold mb-3">Otras cuentas ({otherBills.length})</h2>
                {cobrables.length === 0 || otherBills.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        {cobrables.length === 0 ? 'No hay cuentas activas' : 'No hay otras cuentas. ¡Todo al día!'}
                    </div>
                ) : (
                    <div className="divide-y">
                        {otherBills.filter(matchQ).map((o) => (
                            <div key={o.id} className="py-3 flex items-center justify-between gap-3" data-testid={`caja-pedido-${o.order_number}`}>
                                <div className="min-w-0">
                                    <div className="font-display text-lg font-bold truncate">{accountLabel(o)}</div>
                                    <div className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · {(o.items || []).length} ítems</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</div>
                                    {o.payment_status === 'pagado' ? <div className="text-xs text-primary mt-1">Pagado · sigue en cocina</div> : <Button size="sm" className="mt-1 h-10" onClick={() => selectOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>}
                                    <AccountPaymentAudit order={o} scopeParams={scopeParams} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent></Card>
            </>
            )}

            {tab === 'historial' && (
            <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                    {[['pagos', 'Pagos'], ['platos', 'Platos'], ['turnos', 'Turnos']].map(([k, lab]) => (
                        <Button key={k} variant={histKind === k ? 'default' : 'outline'} className="h-10" onClick={() => setHistKind(k)} data-testid={`caja-hist-${k}`}>
                            {lab}
                        </Button>
                    ))}
                </div>
                {histKind === 'pagos' && <PaymentHistory refreshKey={register?.id} scopeParams={scopeParams} runMutation={runMutation} />}
                {histKind === 'platos' && <SoldDishes refreshKey={register?.id} scopeParams={scopeParams} contextKey={contextKey} branchName={branches.find((branch) => String(branch.id) === String(selectedBranchId))?.name} />}
                {histKind === 'turnos' && <CashHistory refreshKey={register?.id} scopeParams={scopeParams} />}
            </div>
            )}

            {tab === 'turno' && (
            <div className="space-y-5">
                <Card><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div><div className="text-xs text-muted-foreground">Fondo inicial</div><div className="font-display text-xl font-semibold tabular-nums">{fmtMoney(register.opening_amount)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Efectivo esperado</div><div className="font-display text-xl font-semibold tabular-nums" data-testid="caja-turno-esperado">{fmtMoney(register.expected_amount)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Cobros en efectivo</div><div className="font-mono font-semibold tabular-nums">{fmtMoney(register.cash_sales)}</div></div>
                    {['yape', 'plin', 'tarjeta', 'transferencia'].map((m) => (
                        Number((register.by_method || {})[m] || 0) > 0 ? (
                            <div key={m}><div className="text-xs text-muted-foreground">{PAYMENT_LABELS[m]}</div><div className="font-mono font-semibold tabular-nums">{fmtMoney(register.by_method[m])}</div></div>
                        ) : null
                    ))}
                </CardContent></Card>
                <MovementCard register={register} onAdded={refetchReg} runMutation={runMutation} />
                <Button variant="outline" onClick={() => { refetchReg(); setCloseDialog(true); }} className="h-12 w-full" data-testid="caja-cerrar-button"><Lock className="h-4 w-4 mr-2" /> Cerrar turno</Button>
            </div>
            )}
            <CobrarDialog open={!!pendingOrder} onOpenChange={(o) => !o && closeCollection()} order={pendingOrder} onPaid={() => { refetchPending(); refetchReg(); }} />
            <CloseCajaDialog open={closeDialog} onOpenChange={setCloseDialog} register={register} onClosed={refetchReg} runMutation={runMutation} />
        </div>
    );
}

function ConsolidatedCashView({ branches, userKey }) {
    const { data: registers, loading, error } = usePolling(
        () => api.get('/cash').then((r) => r.data),
        12000,
        [userKey]
    );

    return (
        <Card data-testid="caja-consolidated">
            <CardContent className="space-y-4 p-5">
                <div>
                    <h1 className="font-display text-xl font-semibold">Caja consolidada</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Vista de solo lectura de las cajas del negocio. Seleccione una sucursal para operar.</p>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las cajas consolidadas.</p>}
                {loading && !registers ? <p className="text-sm text-muted-foreground">Cargando cajas…</p>
                    : !(registers || []).length ? <p className="text-sm text-muted-foreground">No hay cajas para mostrar.</p>
                        : <div className="divide-y rounded-sm border border-border">
                            {registers.map((register) => {
                                const branch = branches.find((item) => String(item.id) === String(register.branch_id));
                                const branchName = branch?.name || register.branch_name || (register.branch_id ? 'Sucursal no disponible' : 'Registro histórico sin sucursal');
                                return (
                                    <div key={register.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" data-testid={`caja-consolidated-${register.id}`}>
                                        <div>
                                            <div className="font-medium">{branchName}</div>
                                            <div className="text-xs text-muted-foreground">{register.status === 'open' ? 'Abierta' : 'Cerrada'} · {register.opened_by_name || 'Responsable no disponible'}</div>
                                        </div>
                                        <div className="text-right text-sm">
                                            <div>Fondo inicial: <span className="font-mono">{fmtMoney(register.opening_amount)}</span></div>

                                        </div>
                                    </div>
                                );
                            })}
                        </div>}
            </CardContent>
        </Card>
    );
}

export default function Caja() {
    const { user } = useAuth();
    const isOwner = user?.role === 'admin' || user?.functions?.includes('administracion');
    const userKey = user?.id || user?.email || user?.role || 'signed-in';
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [branchesError, setBranchesError] = useState(false);
    const [context, setContext] = useState('all');
    const [mutationsInFlight, setMutationsInFlight] = useState(0);
    const [collectionOpen, setCollectionOpen] = useState(false);

    useEffect(() => {
        setContext('all');
        setCollectionOpen(false);
        if (!isOwner) {
            setBranches([]);
            setBranchesLoading(false);
            setBranchesError(false);
            return undefined;
        }
        let active = true;
        setBranchesLoading(true);
        setBranchesError(false);
        api.get('/branches').then(({ data }) => {
            if (active) setBranches(Array.isArray(data) ? data : []);
        }).catch(() => {
            if (active) {
                setBranches([]);
                setBranchesError(true);
            }
        }).finally(() => {
            if (active) setBranchesLoading(false);
        });
        return () => { active = false; };
    }, [isOwner, userKey]);

    const runMutation = useCallback(async (operation) => {
        setMutationsInFlight((count) => count + 1);
        try {
            return await operation();
        } finally {
            setMutationsInFlight((count) => Math.max(0, count - 1));
        }
    }, []);
    const busy = mutationsInFlight > 0 || collectionOpen;
    const changeContext = (value) => {
        if (!busy) setContext(value);
    };

    const selectedBranchId = isOwner && context.startsWith('branch:') ? context.slice('branch:'.length) : null;
    const branchIsRegistered = selectedBranchId && branches.some((branch) => String(branch.id) === selectedBranchId);
    const scopeParams = useMemo(
        () => context === 'legacy' ? { legacy_only: true } : selectedBranchId ? { branch_id: selectedBranchId } : {},
        [context, selectedBranchId]
    );
    const contextKey = `${userKey}:${context}`;

    if (!isOwner) {
        const staffKey = `staff:${userKey}`;
        return <CajaWorkspace key={staffKey} contextKey={staffKey} scopeParams={{}} runMutation={runMutation} onCollectionChange={setCollectionOpen} />;
    }

    return (
        <div className="space-y-4" data-testid="caja-owner-context">
            <Card>
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <label htmlFor="caja-branch-context" className="text-sm font-medium">Contexto de caja</label>
                        <p className="text-xs text-muted-foreground">La vista consolidada es de solo lectura.</p>
                    </div>
                    <select
                        id="caja-branch-context"
                        data-testid="caja-branch-context"
                        className="h-11 min-w-56 rounded-md border border-border bg-background px-3 text-sm"
                        value={context}
                        disabled={busy}
                        onChange={(event) => changeContext(event.target.value)}
                    >
                        <option value="all">Todas las sucursales · consolidado</option>
                        {branches.map((branch) => <option key={branch.id} value={`branch:${branch.id}`}>{branch.name}</option>)}
                        <option value="legacy">Registros históricos sin sucursal</option>
                    </select>
                </CardContent>
            </Card>
            {branchesLoading && <p className="text-sm text-muted-foreground">Cargando sucursales…</p>}
            {branchesError && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las sucursales. Las operaciones por sucursal no están disponibles.</p>}
            {!branchesLoading && !branchesError && branches.length === 0 && <p className="text-sm text-muted-foreground">No hay sucursales registradas para operar.</p>}
            {context === 'all' ? <ConsolidatedCashView key={contextKey} branches={branches} userKey={userKey} />
                : <CajaWorkspace
                    key={contextKey}
                    ownerContext
                    contextKey={contextKey}
                    scopeParams={scopeParams}
                    selectedBranchId={selectedBranchId}
                    branches={branches}
                    canOpen={!branchesError && !!branchIsRegistered}
                    runMutation={runMutation}
                    onCollectionChange={setCollectionOpen}
                />}
        </div>
    );
}
