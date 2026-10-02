import React, { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { fmtMoney, PAYMENT_LABELS, ORDER_TYPE_LABELS } from '@/lib/format';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { printCajaReceipt } from '@/lib/printReceipt';
import PaymentProofCapture from '@/components/PaymentProofCapture';
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

function accountLabel(order) {
    if (order.table_id) return `Mesa ${order.table_number || order.table_id.slice(0, 4)}`;
    if (order.source === 'public') return `Pedido web #${order.order_number}${order.customer_name ? ` — ${order.customer_name}` : ''}`;
    return `${ORDER_TYPE_LABELS[order.order_type] || 'Pedido'} #${order.order_number}`;
}
export default function OrderCollectionDialog({ open, onOpenChange, order, onPaid }) {
    const { user } = useAuth();
    const canDiscount = user?.role === 'admin' || !!user?.can_discount;
    const canSubmitProof = user?.role === 'admin' || user?.role === 'cajero'
        || user?.functions?.includes('cobro') || user?.functions?.includes('administracion');
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
    const [collectionConfig, setCollectionConfig] = useState(null);
    const [collectionConfigError, setCollectionConfigError] = useState(false);
    const [selectedProof, setSelectedProof] = useState('');
    const [proofIntent, setProofIntent] = useState(null);
    const [proofSending, setProofSending] = useState(false);
    const [proofSent, setProofSent] = useState(false);
    const [proofError, setProofError] = useState('');
    const [proofRefreshPending, setProofRefreshPending] = useState(false);
    const [proofRefreshError, setProofRefreshError] = useState('');
    const idempotencyRef = React.useRef(null);
    const dialogEpochRef = React.useRef(0);

    React.useEffect(() => {
        if (open) {
            dialogEpochRef.current += 1;
            const pendingMethod = order?.payment_status === 'comprobante_subido'
                && ['yape', 'plin'].includes(order.payment_proof_method)
                ? order.payment_proof_method : 'efectivo';
            setMethod(pendingMethod); setReceived(''); setDiscount(''); setDiscountReason(''); setTip('');
            setSplits([{ method: 'efectivo', amount: '' }, { method: 'yape', amount: '' }]);
            setResult(null); setStale(null); setNetError(false);
            setPayMode('todo'); setPeople('2'); setPicked({});
            setLive(order);
            setSelectedProof(''); setProofIntent(null); setProofSending(false); setProofSent(false); setProofError('');
            setProofRefreshPending(false); setProofRefreshError('');
            idempotencyRef.current = newIdempotencyKey();
        } else {
            dialogEpochRef.current += 1;
        }
        // Reset only when this dialog opens for an account, not when parent refetches the list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, order?.id]);

    React.useEffect(() => {
        let cancelled = false;
        setCollectionConfig(null);
        setCollectionConfigError(false);
        if (!open || !canSubmitProof) return () => { cancelled = true; };
        api.get('/payment-config/collection')
            .then(({ data }) => { if (!cancelled) setCollectionConfig(data || {}); })
            .catch(() => { if (!cancelled) setCollectionConfigError(true); });
        return () => { cancelled = true; };
    }, [open, canSubmitProof, user?.restaurant_id]);

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

    const refreshOrderAfterProof = async (orderId, requestEpoch) => {
        try {
            const { data } = await api.get(`/orders/${orderId}`);
            if (dialogEpochRef.current !== requestEpoch || !open) return false;
            if (!data || data.id !== orderId) throw new Error('Invalid order response');
            setLive(data);
            setProofRefreshPending(false);
            setProofRefreshError('');
            return true;
        } catch {
            if (dialogEpochRef.current === requestEpoch && open) {
                setProofRefreshPending(true);
                setProofRefreshError('El comprobante fue recibido, pero no se pudo actualizar la cuenta. Recargue antes de registrar un pago.');
            }
            return false;
        }
    };

    const submitProof = async () => {
        if (!canSubmitProof || proofSending || proofSent) return;
        const intent = proofIntent || { orderId: acct.id, method, payment_proof: selectedProof };
        if (!intent.payment_proof || !collectionConfig?.[intent.method]?.enabled) return;
        const requestEpoch = dialogEpochRef.current;
        const requestOrderId = intent.orderId;
        setProofIntent(intent);
        setProofSending(true);
        setProofError('');
        try {
            await api.post(`/payments/${requestOrderId}/proof`, {
                method: intent.method,
                payment_proof: intent.payment_proof,
            });
            if (dialogEpochRef.current !== requestEpoch || !open) return;
            setProofSent(true);
            setProofRefreshPending(true);
            await refreshOrderAfterProof(requestOrderId, requestEpoch);
        } catch (error) {
            if (dialogEpochRef.current !== requestEpoch || !open) return;
            const detail = error.response?.data?.detail;
            setProofError(typeof detail === 'string' ? detail : 'No se pudo enviar el comprobante. Puede reintentar la misma imagen.');
        } finally {
            if (dialogEpochRef.current === requestEpoch && open) setProofSending(false);
        }
    };

    const retryOrderRefresh = () => refreshOrderAfterProof(proofIntent?.orderId || acct.id, dialogEpochRef.current);

    const submit = async () => {
        if (loading || proofRefreshPending) return;
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
                <DialogHeader>
                    <DialogTitle>{accountLabel(acct)}</DialogTitle>
                    <DialogDescription className="sr-only">Registre un pago verificado o envíe una imagen para revisión.</DialogDescription>
                </DialogHeader>
                {result ? (
                    <div className="space-y-4 py-2" data-testid="caja-pago-ok">
                        <div className="font-display text-2xl">Pago registrado</div>
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
                            <Tabs value={method} onValueChange={(nextMethod) => {
                                if (nextMethod !== method && !proofIntent && !proofSent && acct.payment_status !== 'comprobante_subido') {
                                    setSelectedProof('');
                                }
                                setMethod(nextMethod);
                            }}>
                                <TabsList className="flex flex-wrap h-auto">
                                    {PAYMENT_METHODS.map((m) => <TabsTrigger key={m} value={m} disabled={Boolean(proofIntent && !proofSent)} data-testid={`caja-metodo-${m}`}>{PAYMENT_LABELS[m]}</TabsTrigger>)}
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
                        {['yape', 'plin'].includes(method) && canSubmitProof && (
                            <section className="rounded-xl border p-3 space-y-3" data-testid="caja-comprobante-pago">
                                <h3 className="font-semibold">Pago con {PAYMENT_LABELS[method]}</h3>
                                {collectionConfigError ? (
                                    <p role="status" className="text-sm text-destructive">No se pudo cargar la configuración. Cierre y vuelva a abrir este diálogo.</p>
                                ) : !collectionConfig ? (
                                    <p className="text-sm text-muted-foreground">Cargando opciones de pago…</p>
                                ) : !collectionConfig[method]?.enabled ? (
                                    <p role="status" className="text-sm text-muted-foreground">Este método no está habilitado para recibir comprobantes.</p>
                                ) : (
                                    <>
                                        {collectionConfig[method]?.number && <p className="text-sm">Número: <span className="font-mono">{collectionConfig[method].number}</span></p>}
                                        {collectionConfig[method]?.holder && <p className="text-sm">Titular: {collectionConfig[method].holder}</p>}
                                        {/^data:image\/(png|jpeg|webp);base64,/.test(collectionConfig[method]?.qr || '') ? (
                                            <img src={collectionConfig[method].qr} alt={`Código QR de ${PAYMENT_LABELS[method]}`} className="max-h-52 rounded-lg border object-contain" data-testid={`caja-${method}-qr`} />
                                        ) : (
                                            <p className="text-sm text-muted-foreground">No hay código QR configurado para este método.</p>
                                        )}
                                        {acct.payment_status === 'comprobante_subido' || proofSent ? (
                                            <p className="text-sm text-muted-foreground">El comprobante está pendiente de verificación.</p>
                                        ) : (
                                            <>
                                                <PaymentProofCapture
                                                    key={`${acct.id}:${method}`}
                                                    proof={selectedProof}
                                                    onProof={setSelectedProof}
                                                    disabled={proofSending || Boolean(proofIntent)}
                                                    active={open && canSubmitProof && ['yape', 'plin'].includes(method)}
                                                />
                                                {proofError && <p role="alert" className="text-sm text-destructive" data-testid="caja-comprobante-error">{proofError}</p>}
                                                {proofIntent && !proofSent && <p className="text-xs text-muted-foreground">Se conservará la imagen y el método para reintentar el mismo envío.</p>}
                                                    <Button type="button" className="w-full" onClick={submitProof} disabled={!selectedProof || proofSending || proofSent} data-testid="caja-enviar-comprobante">
                                                    {proofSending ? 'Enviando…' : proofIntent ? 'Reintentar envío del comprobante' : 'Enviar comprobante para revisión'}
                                                </Button>
                                            </>
                                        )}
                                    </>
                                )}
                            </section>
                        )}
                        {(acct.payment_status === 'comprobante_subido' || proofSent) && (
                            <div className="space-y-2 rounded-xl border p-3" data-testid="caja-comprobante-pendiente">
                                <p className="text-sm font-medium" data-testid="caja-comprobante-enviado">
                                    Comprobante {proofSent ? 'enviado' : 'pendiente'} para {PAYMENT_LABELS[proofIntent?.method || acct.payment_proof_method] || 'Yape o Plin'}; está pendiente de verificación.
                                </p>
                                {(proofIntent?.payment_proof || acct.payment_proof_url) && (
                                    <img src={proofIntent?.payment_proof || acct.payment_proof_url} alt="Comprobante enviado" className="max-h-40 rounded-xl border object-contain" />
                                )}
                                {proofRefreshPending && (
                                    <div className="space-y-2">
                                        <p role="alert" className="text-sm text-destructive">{proofRefreshError}</p>
                                        <Button type="button" variant="outline" onClick={retryOrderRefresh} data-testid="caja-recargar-orden">Actualizar cuenta</Button>
                                    </div>
                                )}
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
                    <Button onClick={submit} disabled={loading || proofRefreshPending || chargeAmount <= 0} className="h-12" data-testid="caja-cobrar-submit-button">
                        <CheckCircle2 className="h-4 w-4 mr-2" />{loading ? 'Registrando…' : (netError ? 'Reintentar el mismo cobro' : confirmLabel)}
                    </Button>
                </DialogFooter>
                </>
                )}
            </DialogContent>
        </Dialog>
    );
}
