import React, { useState, useMemo } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtTime, fmtDateTime, PAYMENT_LABELS } from '@/lib/format';
import { Wallet, DollarSign, PlusCircle, MinusCircle, LockOpen, Lock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const PAYMENT_METHODS = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'mixto'];

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

    const { data: register, refetch: refetchReg } = usePolling(() => api.get('/cash/current').then((r) => r.data), 5000);
    const { data: pending, refetch: refetchPending } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        3500
    );

    const cobrables = useMemo(() =>
        (pending || []).filter((o) => ['pendiente_pago', 'entregado', 'listo'].includes(o.status))
    , [pending]);

    if (register === null) return <div className="text-muted-foreground">Cargando…</div>;

    if (!register) return (
        <div className="space-y-4" data-testid="caja-root">
            <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6" /> Caja</h1>
            <OpenCajaCard onOpened={refetchReg} />
        </div>
    );

    return (
        <div className="space-y-5" data-testid="caja-root">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6" /> Caja</h1>
                    <p className="text-muted-foreground text-sm">Abierta por {register.opened_by_name} el {fmtDateTime(register.opened_at)}</p>
                </div>
                <Button variant="outline" onClick={() => setCloseDialog(true)} className="h-11" data-testid="caja-cerrar-button"><Lock className="h-4 w-4 mr-2" /> Cerrar caja</Button>
            </div>

            <Card><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div><div className="text-xs text-muted-foreground">Monto inicial</div><div className="font-display text-xl font-semibold tabular-nums">{fmtMoney(register.opening_amount)}</div></div>
                <div><div className="text-xs text-muted-foreground">Caja</div><StateBadge status={register.status === 'open' ? 'disponible' : 'inactiva'} type="table" /></div>
            </CardContent></Card>

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

            <CobrarDialog open={!!pendingOrder} onOpenChange={(o) => !o && setPendingOrder(null)} order={pendingOrder} onPaid={() => { refetchPending(); refetchReg(); }} />
            <CloseCajaDialog open={closeDialog} onOpenChange={setCloseDialog} register={register} onClosed={refetchReg} />
        </div>
    );
}
