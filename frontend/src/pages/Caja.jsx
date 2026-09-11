import React, { useState, useMemo, useEffect } from 'react';
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
import { Wallet, DollarSign, PlusCircle, MinusCircle, LockOpen, Lock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNotify } from '@/contexts/NotifyContext';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const PAYMENT_METHODS = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'mixto'];

function WebOrderRow({ order, onConfirm }) {
    const [proof, setProof] = useState(null);
    const [showProof, setShowProof] = useState(false);
    const [loading, setLoading] = useState(false);

    const openProof = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/orders/${order.id}`);
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
                <Button size="sm" variant="outline" className="h-8 w-full" onClick={openProof} disabled={loading}>Ver comprobante</Button>
                <Button size="sm" className="h-8 w-full" onClick={onConfirm} data-testid={`caja-confirmar-web-${order.order_number}`}>Confirmar</Button>
            </div>
        </div>
    );
}

function CobrarDialog({ open, onOpenChange, order, onPaid }) {
    const [method, setMethod] = useState('efectivo');
    const [received, setReceived] = useState('');
    const [discount, setDiscount] = useState('');
    const [tip, setTip] = useState('');
    const [splits, setSplits] = useState([{ method: 'efectivo', amount: '' }, { method: 'yape', amount: '' }]);
    const [loading, setLoading] = useState(false);

    React.useEffect(() => {
        if (open) {
            setMethod('efectivo'); setReceived(''); setDiscount(''); setTip('');
            setSplits([{ method: 'efectivo', amount: '' }, { method: 'yape', amount: '' }]);
        }
    }, [open]);

    if (!order) return null;
    const subtotal = order.subtotal || 0;
    const d = Number(discount || 0);
    const t = Number(tip || 0);
    const total = Math.max(0, subtotal - d) + t;
    const r = Number(received || 0);
    const change = method === 'efectivo' ? Math.max(0, r - total) : 0;

    const splitsTotal = splits.reduce((s, x) => s + Number(x.amount || 0), 0);

    const submit = async () => {
        setLoading(true);
        try {
            const payload = {
                order_id: order.id,
                method,
                amount: total,
                discount: d,
                tip: t,
            };
            if (method === 'efectivo') payload.received_amount = r;
            if (method === 'mixto') payload.splits = splits.filter((s) => Number(s.amount) > 0).map((s) => ({ method: s.method, amount: Number(s.amount) }));
            const { data } = await api.post('/payments', payload);
            toast.success(`Cobro de ${fmtMoney(data.total)} registrado`);
            onPaid && onPaid();
            onOpenChange(false);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al cobrar');
        } finally { setLoading(false); }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl" data-testid="caja-cobrar-dialog">
                <DialogHeader><DialogTitle>Cobrar pedido #{order.order_number}</DialogTitle></DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <div className="rounded-xl bg-secondary/40 p-3">
                            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
                            <div className="flex justify-between text-sm"><span>Descuento</span><span className="tabular-nums">- {fmtMoney(d)}</span></div>
                            <div className="flex justify-between text-sm"><span>Propina</span><span className="tabular-nums">+ {fmtMoney(t)}</span></div>
                            <div className="border-t mt-2 pt-2 flex justify-between font-display text-xl font-bold"><span>Total</span><span className="tabular-nums" data-testid="caja-total">{fmtMoney(total)}</span></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div><Label>Descuento (S/)</Label><Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="caja-descuento" /></div>
                            <div><Label>Propina (S/)</Label><Input type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} data-testid="caja-propina" /></div>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div>
                            <Label>Método de pago</Label>
                            <Tabs value={method} onValueChange={setMethod}>
                                <TabsList className="flex flex-wrap h-auto">
                                    {PAYMENT_METHODS.map((m) => <TabsTrigger key={m} value={m} data-testid={`caja-metodo-${m}`}>{PAYMENT_LABELS[m]}</TabsTrigger>)}
                                </TabsList>
                            </Tabs>
                        </div>
                        {method === 'efectivo' && (
                            <div className="space-y-2">
                                <Label>Monto recibido (S/)</Label>
                                <Input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={total.toFixed(2)} className="h-12 text-base tabular-nums" data-testid="caja-recibido-input" />
                                <div className="rounded-xl bg-primary/10 p-3">
                                    <div className="text-xs text-muted-foreground">Vuelto</div>
                                    <div className="font-display text-2xl font-semibold tabular-nums text-primary" data-testid="caja-vuelto">{fmtMoney(change)}</div>
                                </div>
                            </div>
                        )}
                        {method === 'mixto' && (
                            <div className="space-y-2">
                                {splits.map((s, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <Select value={s.method} onValueChange={(v) => { const c = [...splits]; c[idx] = { ...c[idx], method: v }; setSplits(c); }}>
                                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia'].map((m) => <SelectItem key={m} value={m}>{PAYMENT_LABELS[m]}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <Input type="number" min="0" step="0.01" value={s.amount} onChange={(e) => { const c = [...splits]; c[idx] = { ...c[idx], amount: e.target.value }; setSplits(c); }} placeholder="0.00" data-testid={`caja-split-${idx}-amount`} />
                                    </div>
                                ))}
                                <Button variant="ghost" size="sm" onClick={() => setSplits([...splits, { method: 'efectivo', amount: '' }])}>+ Agregar método</Button>
                                <div className="text-sm text-muted-foreground">Total ingresado: <span className={`font-semibold tabular-nums ${splitsTotal >= total ? 'text-primary' : 'text-destructive'}`}>{fmtMoney(splitsTotal)}</span></div>
                            </div>
                        )}
                        {['yape', 'plin', 'tarjeta', 'transferencia'].includes(method) && (
                            <div className="rounded-xl bg-secondary/40 p-3 text-sm">Se cobrará <span className="font-bold tabular-nums">{fmtMoney(total)}</span> vía <strong>{PAYMENT_LABELS[method]}</strong>.</div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={submit} disabled={loading} className="h-11" data-testid="caja-cobrar-submit-button"><CheckCircle2 className="h-4 w-4 mr-2" />Cobrar {fmtMoney(total)}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CashHistory({ refreshKey }) {
    const [period, setPeriod] = useState('day');
    const [data, setData] = useState(null);

    useEffect(() => {
        api.get('/cash/history', { params: { period } }).then((r) => setData(r.data)).catch(() => setData({ registers: [] }));
    }, [period, refreshKey]);

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

function OpenCajaCard({ onOpened }) {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const open = async () => {
        if (!amount) { toast.error('Indica monto inicial'); return; }
        setLoading(true);
        try {
            await api.post('/cash/open', { opening_amount: Number(amount), notes });
            toast.success('Caja abierta');
            onOpened && onOpened();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
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
            <Button onClick={open} disabled={loading} className="mt-4 h-11" data-testid="caja-apertura-submit"><LockOpen className="h-4 w-4 mr-2" /> Abrir caja</Button>
        </CardContent></Card>
    );
}

function CloseCajaDialog({ open, onOpenChange, register, onClosed }) {
    const [closing, setClosing] = useState('');
    const [notes, setNotes] = useState('');
    const submit = async () => {
        if (!closing) { toast.error('Indica monto de cierre'); return; }
        try {
            const { data } = await api.post('/cash/close', { closing_amount: Number(closing), notes });
            toast.success(`Caja cerrada. Diferencia: ${fmtMoney(data.difference)}`);
            onClosed && onClosed();
            onOpenChange(false);
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader><DialogTitle>Cerrar caja</DialogTitle></DialogHeader>
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Cuenta el efectivo en caja al final del turno e ingrese el monto. El sistema calculará la diferencia.</p>
                    <div><Label>Monto contado en caja (S/)</Label><Input type="number" min="0" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)} className="h-11" data-testid="caja-cierre-monto" /></div>
                    <div><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={submit} data-testid="caja-cierre-submit">Cerrar caja</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function MovementCard({ register, onAdded }) {
    const [type, setType] = useState('ingreso');
    const [amount, setAmount] = useState('');
    const [desc, setDesc] = useState('');
    const submit = async () => {
        if (!amount || !desc) { toast.error('Completa los campos'); return; }
        try {
            await api.post('/cash/movements', { type, amount: Number(amount), description: desc });
            toast.success('Movimiento registrado');
            setAmount(''); setDesc('');
            onAdded && onAdded();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
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

export default function Caja() {
    const [pendingOrder, setPendingOrder] = useState(null);
    const [closeDialog, setCloseDialog] = useState(false);

    const { generation } = useNotify();
    const { data: register, loading, refetch: refetchReg } = usePolling(() => api.get('/cash/current').then((r) => r.data), 12000, [generation]);
    const { data: pending, refetch: refetchPending } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        12000,
        [generation]
    );

    const cobrables = useMemo(() =>
        (pending || []).filter((o) => ['pendiente_pago', 'entregado', 'listo'].includes(o.status))
    , [pending]);

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
            await api.post(`/orders/${order.id}/confirm-payment`);
            toast.success(`Pedido #${order.order_number}: pago web confirmado`);
            refetchPending();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo confirmar');
        }
    };

    if (loading && register == null) {
        return <div className="text-muted-foreground">Cargando…</div>;
    }

    if (!register) return (
        <div className="space-y-4" data-testid="caja-root">
            <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
            {cobrables.length > 0 && (
                <p className="text-sm text-muted-foreground">
                    Hay {cobrables.length} cuenta{cobrables.length === 1 ? '' : 's'} pendiente{cobrables.length === 1 ? '' : 's'} de cobro. Abrí caja para cobrar y liberar mesas.
                </p>
            )}
            <OpenCajaCard onOpened={refetchReg} />
            <CashHistory refreshKey="closed" />
        </div>
    );

    return (
        <div className="space-y-5" data-testid="caja-root">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
                    <p className="text-muted-foreground text-sm">Abierta por {register.opened_by_name} el {fmtDateTime(register.opened_at)}</p>
                </div>
                <Button variant="outline" onClick={() => setCloseDialog(true)} className="h-11" data-testid="caja-cerrar-button"><Lock className="h-4 w-4 mr-2" /> Cerrar caja</Button>
            </div>

            <Card><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div><div className="text-xs text-muted-foreground">Monto inicial</div><div className="font-display text-xl font-semibold tabular-nums">{fmtMoney(register.opening_amount)}</div></div>
                <div><div className="text-xs text-muted-foreground">Caja</div><StateBadge status={register.status === 'open' ? 'disponible' : 'inactiva'} type="table" /></div>
            </CardContent></Card>

            {webPending.length > 0 && (
                <Card><CardContent className="p-4">
                    <h2 className="font-display text-lg font-semibold mb-3">Pedidos web ({webPending.length})</h2>
                    <div className="divide-y">
                        {webPending.map((o) => (
                            <WebOrderRow key={o.id} order={o} onConfirm={() => confirmWeb(o)} />
                        ))}
                    </div>
                </CardContent></Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card><CardContent className="p-4">
                    <h2 className="font-display text-lg font-semibold mb-3">Pedidos por cobrar ({cobrables.length})</h2>
                    {cobrables.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">No hay pedidos pendientes de cobro</div>
                    ) : (
                        <div className="divide-y">
                            {cobrables.map((o) => (
                                <div key={o.id} className="py-3 flex items-center justify-between gap-3" data-testid={`caja-pedido-${o.order_number}`}>
                                    <div>
                                        <div className="flex items-center gap-2"><span className="font-display text-lg font-bold">#{o.order_number}</span><StateBadge status={o.status} type="order" /></div>
                                        <div className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · {(o.items || []).length} items · {o.created_by_name}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</div>
                                        <Button size="sm" className="mt-1 h-9" onClick={() => setPendingOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent></Card>

                <MovementCard register={register} onAdded={refetchReg} />
            </div>

            <CashHistory refreshKey={register?.id} />
            <CobrarDialog open={!!pendingOrder} onOpenChange={(o) => !o && setPendingOrder(null)} order={pendingOrder} onPaid={() => { refetchPending(); refetchReg(); }} />
            <CloseCajaDialog open={closeDialog} onOpenChange={setCloseDialog} register={register} onClosed={refetchReg} />
        </div>
    );
}
