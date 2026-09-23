import React, { useState, useMemo, useEffect } from 'react';
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
import { Wallet, DollarSign, PlusCircle, MinusCircle, LockOpen, Lock, CheckCircle2, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useNotify } from '@/contexts/NotifyContext';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { printCajaReceipt } from '@/lib/printReceipt';

const PAYMENT_METHODS = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'mixto'];

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function equalShare(remaining, n) {
    const parts = Math.max(1, Number(n) || 1);
    if (parts <= 1) return round2(remaining);
    return Math.floor((Number(remaining) / parts) * 100) / 100;
}

function newIdempotencyKey() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
}

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

function accountLabel(order) {
    if (order.table_id) return `Mesa ${order.table_number || order.table_id.slice(0, 4)}`;
    if (order.source === 'public') return `Pedido web #${order.order_number}${order.customer_name ? ` — ${order.customer_name}` : ''}`;
    return `${ORDER_TYPE_LABELS[order.order_type] || 'Pedido'} #${order.order_number}`;
}

function CobrarDialog({ open, onOpenChange, order, onPaid }) {
    const { user } = useAuth();
    const canDiscount = user?.role === 'admin' || !!user?.can_discount;
    const [method, setMethod] = useState('efectivo');
    const [received, setReceived] = useState('');
    const [discount, setDiscount] = useState('');
    const [discountReason, setDiscountReason] = useState('');
    const [tip, setTip] = useState('');
    const [splits, setSplits] = useState([{ method: 'efectivo', amount: '' }, { method: 'yape', amount: '' }]);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [stale, setStale] = useState(null);
    const [netError, setNetError] = useState(false);
    const [payMode, setPayMode] = useState('todo');
    const [people, setPeople] = useState('2');
    const [picked, setPicked] = useState({});
    const [live, setLive] = useState(order);
    const idempotencyRef = React.useRef(null);

    React.useEffect(() => {
        if (open) {
            setMethod('efectivo'); setReceived(''); setDiscount(''); setDiscountReason(''); setTip('');
            setSplits([{ method: 'efectivo', amount: '' }, { method: 'yape', amount: '' }]);
            setResult(null); setStale(null); setNetError(false);
            setPayMode('todo'); setPeople('2'); setPicked({});
            setLive(order);
            idempotencyRef.current = newIdempotencyKey();
        }
        // Reset only when this dialog opens for an account, not when parent refetches the list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, order?.id]);

    const acct = live || order;
    if (!acct) return null;
    const subtotal = acct.subtotal || 0;
    const fee = Number(acct.delivery_fee || 0);
    const d = Number(discount || acct.discount || 0);
    const t = Number(tip || acct.tip || 0);
    const total = round2(Math.max(0, subtotal + fee - d) + t);
    const paid = Number(acct.amount_paid || 0);
    const remaining = Math.max(0, round2(total - paid));
    const unpaidItems = (acct.items || []).map((it) => ({
        ...it,
        unpaid: Math.max(0, (it.quantity || 0) - (it.paid_qty || 0)),
    })).filter((it) => it.unpaid > 0);
    const pickedLines = unpaidItems
        .map((it) => ({ item_id: it.id, quantity: Number(picked[it.id] || 0), name: it.product_name, unit_price: it.unit_price }))
        .filter((l) => l.quantity > 0);
    const itemsAmount = round2(pickedLines.reduce((s, l) => s + l.quantity * (l.unit_price || 0), 0));
    const partsN = Math.max(2, parseInt(people, 10) || 2);
    const chargeAmount = payMode === 'items'
        ? itemsAmount
        : payMode === 'partes'
            ? equalShare(remaining, partsN)
            : remaining;
    const r = Number(received || chargeAmount);
    const change = method === 'efectivo' ? Math.max(0, r - chargeAmount) : 0;
    const splitsTotal = splits.reduce((s, x) => s + Number(x.amount || 0), 0);

    const submit = async () => {
        if (loading) return;
        if (Number(discount || 0) > 0 && (discountReason || '').trim().length < 5) {
            toast.error('El descuento requiere un motivo (mínimo 5 caracteres).');
            return;
        }
        setLoading(true);
        setStale(null);
        setNetError(false);
        try {
            const payload = {
                order_id: acct.id,
                method,
                amount: chargeAmount,
                discount: Number(discount || 0),
                discount_reason: Number(discount || 0) > 0 ? discountReason.trim() : undefined,
                tip: Number(tip || 0),
                idempotency_key: idempotencyRef.current,
                expected_updated_at: acct.updated_at,
                expected_total: acct.total,
            };
            if (method === 'efectivo') payload.received_amount = Number(received || chargeAmount);
            if (method === 'mixto') payload.splits = splits.filter((s) => Number(s.amount) > 0).map((s) => ({ method: s.method, amount: Number(s.amount) }));
            if (payMode === 'items' && pickedLines.length) payload.lines = pickedLines.map((l) => ({ item_id: l.item_id, quantity: l.quantity }));
            const { data } = await api.post('/payments', payload);
            setResult(data);
            setNetError(false);
            try {
                const fresh = await api.get(`/orders/${acct.id}`);
                setLive(fresh.data);
            } catch { /* keep snapshot */ }
            onPaid && onPaid();
        } catch (e) {
            if (!e.response) {
                setNetError(true);
                toast.error('Se cortó la conexión. No cobres de nuevo a ciegas: reintentá esta misma operación.');
            } else {
                const detail = e.response?.data?.detail;
                if (e.response?.status === 409 && detail?.code === 'account_changed') {
                    setStale(detail);
                } else {
                    toast.error(typeof detail === 'string' ? detail : (detail?.message || 'Error al cobrar'));
                    idempotencyRef.current = newIdempotencyKey();
                }
            }
        } finally { setLoading(false); }
    };

    const confirmLabel = ['yape', 'plin', 'tarjeta', 'transferencia'].includes(method)
        ? `Registrar pago verificado ${fmtMoney(chargeAmount)}`
        : `Confirmar cobro de ${fmtMoney(chargeAmount)}`;

    const doPrint = () => {
        const ok = printCajaReceipt({
            restaurantName: 'Sabor Peruano',
            label: accountLabel(acct),
            order: acct,
            payment: result,
            items: payMode === 'items' && pickedLines.length
                ? pickedLines.map((l) => ({ product_name: l.name, quantity: l.quantity, unit_price: l.unit_price, pay_qty: l.quantity }))
                : acct.items,
        });
        if (!ok) toast.error('El navegador bloqueó la ventana. Permití popups para imprimir.');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl" data-testid="caja-cobrar-dialog">
                <DialogHeader><DialogTitle>{accountLabel(acct)}</DialogTitle></DialogHeader>
                {result ? (
                    <div className="space-y-4 py-2" data-testid="caja-pago-ok">
                        <div className="font-display italic text-2xl">Pago registrado</div>
                        <p className="text-sm text-muted-foreground">
                            {result.fully_paid
                                ? 'No hace falta volver a cobrar. La mesa sigue ocupada hasta que el mozo la libere.'
                                : 'Pago parcial. La cuenta sigue abierta con el saldo de abajo.'}
                        </p>
                        {result.change_amount > 0 && (
                            <div className="rounded-xl bg-primary/10 p-4">
                                <div className="text-xs text-muted-foreground">Entregar vuelto</div>
                                <div className="font-mono text-3xl font-bold text-primary">{fmtMoney(result.change_amount)}</div>
                            </div>
                        )}
                        {!result.fully_paid && (
                            <div className="text-sm">Pendiente: <span className="font-mono font-semibold">{fmtMoney(result.remaining)}</span></div>
                        )}
                        <p className="text-sm">Pago confirmado. Si falla la impresora, no vuelvas a cobrar.</p>
                        <DialogFooter>
                            <Button variant="outline" className="h-12" onClick={doPrint} data-testid="caja-imprimir">Comprobante</Button>
                            {result.fully_paid ? (
                                <Button className="h-12" onClick={() => { onOpenChange(false); setResult(null); }} data-testid="caja-siguiente">Siguiente cuenta</Button>
                            ) : (
                                <Button className="h-12" onClick={() => {
                                    setResult(null);
                                    setPayMode('todo');
                                    setPicked({});
                                    setReceived('');
                                    setNetError(false);
                                    setStale(null);
                                    idempotencyRef.current = newIdempotencyKey();
                                }} data-testid="caja-cobrar-resto">Cobrar el resto</Button>
                            )}
                        </DialogFooter>
                    </div>
                ) : (
                <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <div className="flex gap-2 mb-2">
                            {[
                                ['todo', 'Toda la cuenta'],
                                ['items', 'Por ítems'],
                                ['partes', 'Partes iguales'],
                            ].map(([k, lab]) => (
                                <button key={k} type="button" onClick={() => setPayMode(k)} className={`text-xs px-2 py-1 rounded-sm border ${payMode === k ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}>{lab}</button>
                            ))}
                        </div>
                        <div className="space-y-1 text-sm">
                            {(acct.items || []).map((it) => {
                                const unpaid = Math.max(0, (it.quantity || 0) - (it.paid_qty || 0));
                                const paidQty = it.paid_qty || 0;
                                return (
                                <div key={it.id} className="flex justify-between gap-2 items-center">
                                    <label className="flex items-center gap-2 min-w-0">
                                        {payMode === 'items' && unpaid > 0 && (
                                            <input
                                                type="number"
                                                min="0"
                                                max={unpaid}
                                                className="w-12 h-8 border rounded-sm px-1 font-mono"
                                                value={picked[it.id] ?? 0}
                                                onChange={(e) => setPicked({ ...picked, [it.id]: Math.min(unpaid, Math.max(0, Number(e.target.value))) })}
                                            />
                                        )}
                                        <span className={unpaid === 0 ? 'text-muted-foreground line-through' : ''}>
                                            {it.quantity}× {it.product_name}
                                            {paidQty > 0 ? ` · ${paidQty} pagados` : ''}
                                        </span>
                                    </label>
                                    <span className="font-mono tabular-nums">{fmtMoney(it.subtotal)}</span>
                                </div>
                                );
                            })}
                        </div>
                        {payMode === 'partes' && (
                            <div>
                                <Label>Personas</Label>
                                <Input type="number" min="2" value={people} onChange={(e) => setPeople(e.target.value)} className="h-10 w-24" />
                                <div className="text-sm mt-1">Esta parte: <span className="font-mono font-semibold">{fmtMoney(chargeAmount)}</span></div>
                                <p className="text-xs text-muted-foreground">El último cierra con «Toda la cuenta» para no dejar céntimos.</p>
                            </div>
                        )}
                        {payMode !== 'todo' && (
                            <div className="text-sm font-semibold">Este cobro: {fmtMoney(chargeAmount)}</div>
                        )}
                        {netError && (
                            <div className="rounded-xl border border-accent p-3 text-sm" data-testid="caja-red-error">
                                Se cortó la conexión. El pago puede haberse registrado. No inicies otro cobro: reintentá esta misma operación.
                            </div>
                        )}
                        {stale && (
                            <div className="rounded-xl border border-accent p-3 text-sm" data-testid="caja-cuenta-cambio">
                                {stale.message || 'La cuenta cambió mientras la revisabas.'}
                                {stale.new_total != null && <div className="mt-1 font-mono">Nuevo total: {fmtMoney(stale.new_total)}</div>}
                            </div>
                        )}
                        <div className="rounded-xl bg-secondary/40 p-3">
                            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
                            {fee > 0 && <div className="flex justify-between text-sm"><span>Envío</span><span className="tabular-nums">{fmtMoney(fee)}</span></div>}
                            <div className="flex justify-between text-sm"><span>Descuento</span><span className="tabular-nums">- {fmtMoney(d)}</span></div>
                            <div className="flex justify-between text-sm"><span>Propina</span><span className="tabular-nums">+ {fmtMoney(t)}</span></div>
                            <div className="border-t mt-2 pt-2 flex justify-between font-display text-xl font-bold"><span>Total</span><span className="tabular-nums" data-testid="caja-total">{fmtMoney(total)}</span></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {canDiscount ? (
                                <div><Label>Descuento (S/)</Label><Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="caja-descuento" /></div>
                            ) : (
                                <div className="text-xs text-muted-foreground self-end pb-2">Sin permiso de descuento</div>
                            )}
                            <div><Label>Propina (S/)</Label><Input type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} data-testid="caja-propina" /></div>
                        </div>
                        {canDiscount && d > 0 && (
                            <div>
                                <Label>Motivo del descuento</Label>
                                <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Ej. cortesía de la casa" data-testid="caja-descuento-motivo" />
                            </div>
                        )}
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
                                <Input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={chargeAmount.toFixed(2)} className="h-12 text-base tabular-nums" data-testid="caja-recibido-input" />
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
                                <div className="text-sm text-muted-foreground">Total ingresado: <span className={`font-semibold tabular-nums ${splitsTotal >= chargeAmount ? 'text-primary' : 'text-destructive'}`}>{fmtMoney(splitsTotal)}</span></div>
                            </div>
                        )}
                        {['yape', 'plin', 'tarjeta', 'transferencia'].includes(method) && (
                            <div className="rounded-xl bg-secondary/40 p-3 text-sm">
                                Verificá el movimiento en la cuenta receptora. Luego registrá el pago verificado de <span className="font-bold tabular-nums">{fmtMoney(chargeAmount)}</span>.
                            </div>
                        )}
                        <div className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1">
                            <div className="flex justify-between"><span>Pagado</span><span className="font-mono">{fmtMoney(paid)}</span></div>
                            <div className="flex justify-between font-semibold"><span>Pendiente</span><span className="font-mono">{fmtMoney(remaining)}</span></div>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={submit} disabled={loading || chargeAmount <= 0} className="h-12" data-testid="caja-cobrar-submit-button">
                        <CheckCircle2 className="h-4 w-4 mr-2" />{loading ? 'Registrando…' : (netError ? 'Reintentar el mismo cobro' : confirmLabel)}
                    </Button>
                </DialogFooter>
                </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function PaymentHistory({ refreshKey }) {
    const { user } = useAuth();
    const canVoid = user?.role === 'admin' || !!user?.can_void;
    const [period, setPeriod] = useState('day');
    const [q, setQ] = useState('');
    const [items, setItems] = useState(null);
    const [detail, setDetail] = useState(null);
    const [voidKind, setVoidKind] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [reload, setReload] = useState(0);

    useEffect(() => {
        const params = { period, limit: 200 };
        if (q.trim()) params.q = q.trim();
        api.get('/payments', { params }).then((r) => setItems(r.data)).catch(() => setItems([]));
    }, [period, q, refreshKey, reload]);

    const reprint = async (p) => {
        let order = null;
        try {
            const { data } = await api.get(`/orders/${p.order_id}`);
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
            if (canVoid) {
                const { data } = await api.post(`/payments/${detail.id}/void`, { kind: voidKind, reason: voidReason.trim() });
                toast.success(voidKind === 'refund' ? 'Devolución registrada. El cobro sigue en el historial.' : 'Anulación registrada. El cobro no se eliminó.');
                setDetail(data);
            } else {
                await api.post('/approvals', { kind: voidKind, reason: voidReason.trim(), payment_id: detail.id });
                toast.success('Solicitud enviada al encargado. No cobres de nuevo mientras tanto.');
                setDetail(null);
            }
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
                <Input className="h-11" placeholder="Buscar #pedido, método o cajero" value={q} onChange={(e) => setQ(e.target.value)} data-testid="caja-hist-pagos-buscar" />
                {!items ? (
                    <div className="text-sm text-muted-foreground">Cargando pagos…</div>
                ) : items.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No hay pagos en este período.</div>
                ) : (
                    <div className="divide-y border border-border rounded-sm">
                        {items.map((p) => (
                            <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm" data-testid={`caja-pago-${p.id}`}>
                                <button type="button" className="text-left min-w-0" onClick={() => setDetail(p)}>
                                    <div className="font-medium">Pedido #{p.order_number} · {PAYMENT_LABELS[p.method] || p.method}{statusLabel(p) ? ` · ${statusLabel(p)}` : ''}</div>
                                    <div className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)} · {p.paid_by_name}</div>
                                </button>
                                <div className="text-right shrink-0 space-y-1">
                                    <div className="font-mono font-semibold tabular-nums">{fmtMoney(p.amount)}</div>
                                    <Button size="sm" variant="outline" className="h-8" onClick={() => reprint(p)} data-testid={`caja-reimprimir-${p.id}`}>
                                        <Printer className="h-3.5 w-3.5 mr-1" />Comprobante
                                    </Button>
                                </div>
                            </div>
                        ))}
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

function SoldDishes({ refreshKey }) {
    const [period, setPeriod] = useState('day');
    const [data, setData] = useState(null);

    useEffect(() => {
        api.get('/reports/products', { params: { period } }).then((r) => setData(r.data)).catch(() => setData({ products: [] }));
    }, [period, refreshKey]);

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
                {!data ? (
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
            const { data } = await api.post('/cash/close', { closing_amount: Number(closing), notes });
            const delta = Number(data.difference || 0);
            toast.success(delta === 0 ? 'Turno cerrado. El cajón cuadra.' : `Turno cerrado. Diferencia: ${fmtMoney(delta)}`);
            onClosed && onClosed();
            onOpenChange(false);
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
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
    const [params] = useSearchParams();
    const [pendingOrder, setPendingOrder] = useState(null);
    const [closeDialog, setCloseDialog] = useState(false);
    const [tab, setTab] = useState('cobrar');
    const [histKind, setHistKind] = useState('pagos');
    const [query, setQuery] = useState('');

    const { generation } = useNotify();
    const { data: register, loading, refetch: refetchReg } = usePolling(() => api.get('/cash/current').then((r) => r.data), 12000, [generation]);
    const { data: pending, refetch: refetchPending } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        12000,
        [generation]
    );
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 20000, [generation]);

    useEffect(() => {
        const id = params.get('order');
        if (!id || !pending) return;
        const hit = pending.find((o) => o.id === id);
        if (hit) setPendingOrder(hit);
    }, [params, pending]);

    const cobrables = useMemo(() => {
        const list = (pending || []).filter((o) => o.status !== 'pagado' && o.status !== 'cancelado');
        const requested = list.filter((o) => o.status === 'pendiente_pago');
        const rest = list.filter((o) => o.status !== 'pendiente_pago');
        return [...requested, ...rest].map((o) => ({
            ...o,
            table_number: (tables || []).find((t) => t.id === o.table_id)?.number,
        }));
    }, [pending, tables]);

    const requestedBills = useMemo(() => cobrables.filter((o) => o.status === 'pendiente_pago'), [cobrables]);
    const otherBills = useMemo(() => cobrables.filter((o) => o.status !== 'pendiente_pago'), [cobrables]);

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
            <OpenCajaCard onOpened={refetchReg} />
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
                                        {o.status === 'pendiente_pago' && <span className="text-xs text-primary shrink-0">Cuenta solicitada</span>}
                                    </div>
                                    <span className="font-mono font-semibold tabular-nums shrink-0">{fmtMoney(o.total)}</span>
                                </div>
                            ))}
                        </div>
                        {cobrables.length > 8 && <div className="text-xs text-muted-foreground mt-2">y {cobrables.length - 8} más…</div>}
                    </CardContent>
                </Card>
            )}
            <CashHistory refreshKey="closed" />
        </div>
    );

    return (
        <div className="space-y-5" data-testid="caja-root">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
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
                            <WebOrderRow key={o.id} order={o} onConfirm={() => confirmWeb(o)} />
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
                                    <Button size="sm" className="mt-1 h-10" onClick={() => setPendingOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>
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
                                    <Button size="sm" className="mt-1 h-10" onClick={() => setPendingOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>
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
                {histKind === 'pagos' && <PaymentHistory refreshKey={register?.id} />}
                {histKind === 'platos' && <SoldDishes refreshKey={register?.id} />}
                {histKind === 'turnos' && <CashHistory refreshKey={register?.id} />}
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
                <MovementCard register={register} onAdded={refetchReg} />
                <Button variant="outline" onClick={() => { refetchReg(); setCloseDialog(true); }} className="h-12 w-full" data-testid="caja-cerrar-button"><Lock className="h-4 w-4 mr-2" /> Cerrar turno</Button>
            </div>
            )}
            <CobrarDialog open={!!pendingOrder} onOpenChange={(o) => !o && setPendingOrder(null)} order={pendingOrder} onPaid={() => { refetchPending(); refetchReg(); }} />
            <CloseCajaDialog open={closeDialog} onOpenChange={setCloseDialog} register={register} onClosed={refetchReg} />
        </div>
    );
}
