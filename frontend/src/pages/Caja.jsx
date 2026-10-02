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
import { Wallet, DollarSign, PlusCircle, MinusCircle, LockOpen, Lock, CheckCircle2, Printer, Search, Banknote, Smartphone, CreditCard, Building2, ArrowLeftRight, Copy, Check, Image, Camera, Maximize2, HelpCircle, Info, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useNotify } from '@/contexts/NotifyContext';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { printCajaReceipt } from '@/lib/printReceipt';
import PaymentProofCapture from '@/components/PaymentProofCapture';
import '@/styles/cobro.css';

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
    const canSubmitProof = user?.role === 'admin' || user?.role === 'cajero'
        || user?.functions?.includes('cobro') || user?.functions?.includes('administracion');

    // Method mapping: prototype id -> backend id
    const METHOD_MAP = { cash: 'efectivo', yape: 'yape', plin: 'plin', card: 'tarjeta', transfer: 'transferencia', mixed: 'mixto' };
    const METHOD_REV = Object.fromEntries(Object.entries(METHOD_MAP).map(([k, v]) => [v, k]));
    const METHODS = [
        { id: 'cash', name: 'Efectivo', Icon: Banknote },
        { id: 'yape', name: 'Yape', Icon: Smartphone },
        { id: 'plin', name: 'Plin', Icon: Smartphone },
        { id: 'card', name: 'Tarjeta', Icon: CreditCard },
        { id: 'transfer', name: 'Transferencia', Icon: Building2 },
        { id: 'mixed', name: 'Mixto', Icon: ArrowLeftRight },
    ];

    // State
    const [method, setMethod] = useState('cash');
    const [received, setReceived] = useState('');
    const [discount, setDiscount] = useState('');
    const [discountReason, setDiscountReason] = useState('');
    const [tip, setTip] = useState('');
    const [tipPct, setTipPct] = useState(0);
    const [splits, setSplits] = useState([{ method: 'cash', amount: '' }, { method: 'yape', amount: '' }]);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [stale, setStale] = useState(null);
    const [netError, setNetError] = useState(false);
    const [payMode, setPayMode] = useState('all');
    const [people, setPeople] = useState(2);
    const [part, setPart] = useState(0);
    const [picked, setPicked] = useState({});
    const [live, setLive] = useState(order);
    const [detailOpen, setDetailOpen] = useState(true);
    const [showVerify, setShowVerify] = useState(false);
    const [verified, setVerified] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [proofFile, setProofFile] = useState(null);
    const [proofUrl, setProofUrl] = useState(null);
    const [cardRef, setCardRef] = useState('');
    const [toastMsg, setToastMsg] = useState('');
    const [collectionConfig, setCollectionConfig] = useState(null);
    const [collectionConfigError, setCollectionConfigError] = useState(false);
    const [selectedProof, setSelectedProof] = useState('');
    const [proofIntent, setProofIntent] = useState(null);
    const [proofSending, setProofSending] = useState(false);
    const [proofSent, setProofSent] = useState(false);
    const [proofError, setProofError] = useState('');
    const [proofRefreshPending, setProofRefreshPending] = useState(false);
    const [proofRefreshError, setProofRefreshError] = useState('');
    const idempotencyRef = useRef(null);
    const fileInputRef = useRef(null);
    const dialogEpochRef = useRef(0);

    const showToast = useCallback((msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 4000);
    }, []);

    // Reset on open. A closed dialog advances the epoch so a late upload cannot land on the next account.
    useEffect(() => {
        if (open) {
            dialogEpochRef.current += 1;
            const pendingMethod = order?.payment_status === 'comprobante_subido'
                && ['yape', 'plin'].includes(order.payment_proof_method)
                ? (METHOD_REV[order.payment_proof_method] || 'cash')
                : 'cash';
            setMethod(pendingMethod); setReceived(''); setDiscount(''); setDiscountReason(''); setTip('');
            setTipPct(0);
            setSplits([{ method: 'cash', amount: '' }, { method: 'yape', amount: '' }]);
            setResult(null); setStale(null); setNetError(false);
            setPayMode('all'); setPeople(2); setPart(0); setPicked({});
            setLive(order); setDetailOpen(true); setShowVerify(false); setVerified(false);
            setShowHelp(false); setShowHistory(false);
            setProofFile(null); setProofUrl(null); setCardRef('');
            setSelectedProof(''); setProofIntent(null); setProofSending(false); setProofSent(false); setProofError('');
            setProofRefreshPending(false); setProofRefreshError('');
            idempotencyRef.current = newIdempotencyKey();
        } else {
            dialogEpochRef.current += 1;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, order?.id]);

    useEffect(() => {
        let cancelled = false;
        setCollectionConfig(null);
        setCollectionConfigError(false);
        if (!open || !canSubmitProof) return () => { cancelled = true; };
        api.get('/payment-config/collection')
            .then(({ data }) => { if (!cancelled) setCollectionConfig(data || {}); })
            .catch(() => { if (!cancelled) setCollectionConfigError(true); });
        return () => { cancelled = true; };
    }, [open, canSubmitProof, user?.restaurant_id]);

    if (!open) return null;
    const acct = live || order;
    if (!acct) return null;

    // Computed values
    const subtotal = acct.subtotal || 0;
    const fee = Number(acct.delivery_fee || 0);
    const d = Number(discount || acct.discount || 0);
    const tipVal = Number(tip || 0);
    const baseTotal = round2(Math.max(0, subtotal + fee - d));
    const total = round2(baseTotal + tipVal);
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

    const partsN = Math.max(2, people);
    const chargeAmount = payMode === 'items'
        ? itemsAmount
        : payMode === 'equal'
            ? equalShare(remaining, partsN)
            : remaining;

    const backendMethod = METHOD_MAP[method] || 'efectivo';
    const r = Number(received || 0);
    const change = method === 'cash' ? Math.max(0, r - chargeAmount) : 0;
    const splitsTotal = splits.reduce((s, x) => s + Number(x.amount || 0), 0);

    // Mixed payment helpers
    const mixedData = () => {
        const due = chargeAmount;
        const ls = splits;
        const n = ls.length;
        let sum = 0;
        let error = '';
        let ok = true;
        const lines = ls.map((l, i) => {
            if (i === n - 1) return { method: METHOD_MAP[l.method] || l.method, cents: 0 };
            const amt = Number(l.amount || 0);
            if (!amt || amt <= 0) { ok = false; if (l.amount) error = 'Cada importe debe ser mayor que cero.'; }
            else sum += amt;
            return { method: METHOD_MAP[l.method] || l.method, cents: amt };
        });
        const rest = round2(due - sum);
        lines[n - 1].cents = rest;
        const usedMethods = ls.map(l => l.method);
        if (new Set(usedMethods).size !== n) { ok = false; error = 'Elige un metodo distinto en cada linea.'; }
        if (rest <= 0) { ok = false; if (!error && ls.slice(0, -1).every(l => l.amount)) error = 'Los importes ya cubren el total.'; }
        return { lines, sum, rest, due, valid: ok && due > 0, error };
    };

    // Can register?
    const canRegister = () => {
        if (chargeAmount <= 0) return false;
        if (method === 'cash') return r >= chargeAmount;
        if (method === 'mixed') return mixedData().valid;
        return true;
    };

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
        const intent = proofIntent || { orderId: acct.id, method: backendMethod, payment_proof: selectedProof };
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

    // Submit
    const doSubmit = async () => {
        if (loading || proofRefreshPending) return;
        if (Number(discount || 0) > 0 && (discountReason || '').trim().length < 5) {
            toast.error('El descuento requiere un motivo (minimo 5 caracteres).');
            return;
        }
        setLoading(true);
        setStale(null);
        setNetError(false);
        try {
            const payload = {
                order_id: acct.id,
                method: backendMethod,
                amount: chargeAmount,
                discount: Number(discount || 0),
                discount_reason: Number(discount || 0) > 0 ? discountReason.trim() : undefined,
                tip: tipVal,
                idempotency_key: idempotencyRef.current,
                expected_updated_at: acct.updated_at,
                expected_total: acct.total,
            };
            if (method === 'cash') payload.received_amount = r || chargeAmount;
            if (method === 'mixed') {
                const md = mixedData();
                payload.splits = md.lines.filter((s) => s.cents > 0).map((s) => ({ method: s.method, amount: s.cents }));
            }
            if (payMode === 'items' && pickedLines.length) {
                payload.lines = pickedLines.map((l) => ({ item_id: l.item_id, quantity: l.quantity }));
            }
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
                toast.error('Se corto la conexion. No cobres de nuevo a ciegas: reintenta esta misma operacion.');
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

    const handleRegister = () => {
        if (result || proofRefreshPending) return;
        if (!canRegister()) return;
        setShowVerify(true);
        setVerified(false);
    };

    const handleConfirm = () => {
        setShowVerify(false);
        doSubmit();
    };

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
        if (!ok) toast.error('El navegador bloqueo la ventana. Permite popups para imprimir.');
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            showToast('Formato no compatible. Usa PNG, JPG o WebP.');
            return;
        }
        if (file.size > 1800000) {
            showToast('La imagen supera 1.8 MB.');
            return;
        }
        setProofFile(file);
        setProofUrl(URL.createObjectURL(file));
    };

    const removeProof = () => {
        if (proofUrl) URL.revokeObjectURL(proofUrl);
        setProofFile(null);
        setProofUrl(null);
    };

    const copyText = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            showToast(label + ' copiado');
        } catch {
            showToast('No se pudo copiar');
        }
    };

    // Tip chips
    const tipChips = [0, 5, 10, 15];
    const handleTipChip = (pct) => {
        setTipPct(pct);
        if (pct === 0) { setTip(''); }
        else { setTip(String(round2(baseTotal * pct / 100))); }
    };

    // Preset cash
    const handlePreset = (val) => {
        if (val === 'exact') setReceived(String(chargeAmount));
        else setReceived(String(val / 100));
    };

    // Verify dialog copy
    const verifyCopy = method === 'cash'
        ? 'Recibi el efectivo y comprobe el vuelto.'
        : method === 'card'
            ? 'Comprobe que el POS aprobo este cobro.'
            : method === 'mixed'
                ? 'Verifique todos los pagos y recibi el efectivo, si corresponde.'
                : 'Verifique el ingreso en la cuenta receptora.';

    const verifyWarning = method === 'cash'
        ? 'El importe registrado corresponde al cobro, no al efectivo entregado por el cliente.'
        : method === 'mixed'
            ? 'Todos los componentes se registraran juntos.'
            : 'Confirmacion manual. Adjuntar una imagen no verifica automaticamente el pago.';

    // Register button label
    const registerLabel = () => {
        if (result) return 'Finalizar';
        const amt = chargeAmount > 0 ? ` · ${fmtMoney(chargeAmount)}` : '';
        if (method === 'cash') return 'Registrar efectivo' + amt;
        return 'Registrar pago verificado' + amt;
    };

    // Footer note
    const footerNote = () => {
        if (!canRegister() && !result) {
            if (method === 'cash' && !r) return 'Ingresa el efectivo recibido';
            if (method === 'cash' && r < chargeAmount) return 'El efectivo recibido no cubre el total';
            if (method === 'mixed') return 'Completa los montos del pago mixto';
            if (chargeAmount <= 0) return 'Selecciona al menos un item';
        }
        return '';
    };

    const walletMethod = method === 'yape' || method === 'plin';
    const showLocalProof = method === 'card' || method === 'transfer';
    const walletConfig = collectionConfig?.[backendMethod];
    const proofAlreadySent = acct.payment_status === 'comprobante_subido' || proofSent;

    return (
        <div className="cobro-overlay" onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
        <div className="cobro-checkout" data-testid="caja-cobrar-dialog" role="dialog" aria-labelledby="checkout-title">
            {/* Header */}
            <header className="cobro-checkout-header">
                <span className="table-mark" aria-hidden="true"><CreditCard style={{ width: 26, height: 26 }} /></span>
                <div>
                    <h1 id="checkout-title">{accountLabel(acct)}</h1>
                    <div className="header-meta">
                        <span>{(acct.items || []).length} items</span>
                        <span className="dot" />
                        <span>{result ? 'Pagada' : paid > 0 ? 'Pago parcial' : 'Cuenta abierta'}</span>
                    </div>
                </div>
                <div className="header-right">
                    <button className="icon-button" onClick={() => onOpenChange(false)} aria-label="Cerrar cobro">
                        <X style={{ width: 20, height: 20 }} />
                    </button>
                </div>
            </header>

            {/* Content */}
            <div className="cobro-checkout-content">
                {/* Order Panel */}
                <section className="order-panel" aria-label="Detalle y total de la cuenta">
                    {/* Scope Tabs */}
                    <div className="scope-tabs" role="tablist" aria-label="Como dividir la cuenta">
                        {[['all', 'Toda la cuenta'], ['items', 'Por items'], ['equal', 'Partes iguales']].map(([k, lab]) => (
                            <button key={k} className="scope-tab" role="tab" aria-selected={payMode === k} onClick={() => { setPayMode(k); if (k === 'items') setDetailOpen(true); }}>
                                {lab}
                            </button>
                        ))}
                    </div>

                    {/* Split settings */}
                    {payMode === 'equal' && (
                        <div className="split-settings">
                            <span className="split-label">Dividir entre</span>
                            <div className="stepper">
                                <button onClick={() => people > 2 && setPeople(people - 1)} disabled={people <= 2} aria-label="Una persona menos">-</button>
                                <output aria-label="Numero de personas">{people}</output>
                                <button onClick={() => people < 12 && setPeople(people + 1)} disabled={people >= 12} aria-label="Una persona mas">+</button>
                            </div>
                            <select className="split-select" value={part} onChange={(e) => setPart(Number(e.target.value))}>
                                {Array.from({ length: people }, (_, i) => (
                                    <option key={i} value={i}>Parte {i + 1}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Order heading */}
                    <div className="order-heading">
                        <h2 className="section-heading">Detalle de la cuenta</h2>
                        <span className="item-count">{(acct.items || []).length} items</span>
                        <button className="detail-toggle" aria-expanded={detailOpen} onClick={() => setDetailOpen(!detailOpen)}>
                            <span>{detailOpen ? 'Ocultar' : `Ver ${(acct.items || []).length} items`}</span>
                            <ChevronDown style={{ width: 16, height: 16 }} />
                        </button>
                    </div>

                    {/* Line items */}
                    <div className="line-items-region" hidden={!detailOpen}>
                        <table className="line-items">
                            <thead>
                                <tr>
                                    <th>{payMode === 'items' ? 'Sel.' : 'Cant.'}</th>
                                    <th>Descripcion</th>
                                    <th>Importe</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(acct.items || []).map((it) => {
                                    const unpaid = Math.max(0, (it.quantity || 0) - (it.paid_qty || 0));
                                    const paidQty = it.paid_qty || 0;
                                    const isSelected = payMode === 'items' && (picked[it.id] || 0) > 0;
                                    return (
                                        <tr key={it.id}
                                            className={`${payMode === 'items' && unpaid > 0 ? 'item-selectable' : ''} ${isSelected ? 'item-selected' : ''} ${unpaid === 0 ? 'item-settled' : ''}`}
                                            onClick={() => {
                                                if (payMode === 'items' && unpaid > 0) {
                                                    setPicked({ ...picked, [it.id]: picked[it.id] ? 0 : unpaid });
                                                }
                                            }}
                                        >
                                            <td>
                                                {payMode === 'items' && unpaid > 0 ? (
                                                    <input type="checkbox" className="item-check" checked={isSelected}
                                                        onChange={(e) => { e.stopPropagation(); setPicked({ ...picked, [it.id]: e.target.checked ? unpaid : 0 }); }}
                                                        aria-label={`${isSelected ? 'Quitar' : 'Cobrar'}: ${it.product_name}`}
                                                    />
                                                ) : `${it.quantity}x`}
                                            </td>
                                            <td>
                                                <span className="item-name">{it.product_name}</span>
                                                {paidQty > 0 && <span className="item-paid-label">{paidQty} pagados</span>}
                                            </td>
                                            <td className="amount">{fmtMoney(it.subtotal)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {payMode === 'items' && <p className="selection-hint">Selecciona los productos que vas a cobrar.</p>}

                    {/* Charge Summary */}
                    <div className="charge-summary">
                        <div className="summary-line">
                            <span>{payMode === 'equal' ? 'Subtotal de esta parte' : 'Subtotal'}</span>
                            <span className="amount">{fmtMoney(payMode === 'items' ? itemsAmount : payMode === 'equal' ? equalShare(baseTotal, partsN) : baseTotal)}</span>
                        </div>
                        <div className="summary-line">
                            <span className="discount-label" title={canDiscount ? '' : 'No editable'}>
                                Descuento{!canDiscount && <Lock style={{ width: 12, height: 12 }} />}
                            </span>
                            <span className="amount">- {fmtMoney(d)}</span>
                        </div>

                        {/* Tip */}
                        <div className="tip-box">
                            <div className="summary-line tip-line">
                                <label>{payMode === 'all' ? 'Propina' : 'Propina proporcional'}</label>
                                {payMode === 'all' ? (
                                    <div className="currency-input">
                                        <span>S/</span>
                                        <input type="text" inputMode="decimal" value={tip} placeholder="Otro monto"
                                            onChange={(e) => { setTip(e.target.value); setTipPct(0); }}
                                            aria-label="Otro monto de propina" />
                                    </div>
                                ) : (
                                    <span className="amount">{fmtMoney(tipVal)}</span>
                                )}
                            </div>
                            {payMode === 'all' && (
                                <div className="tip-chips" role="group" aria-label="Propina por porcentaje">
                                    {tipChips.map((pct) => (
                                        <button key={pct} className="tip-chip" aria-pressed={pct === 0 ? (!tip && tipPct === 0) : (tipPct === pct)}
                                            onClick={() => handleTipChip(pct)}>
                                            {pct ? `${pct}%` : 'Sin propina'}
                                            {pct > 0 && <small>{fmtMoney(round2(baseTotal * pct / 100))}</small>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Discount fields */}
                    {canDiscount && (
                        <div className="discount-fields">
                            <label>Descuento (S/)</label>
                            <input type="number" min="0" step="0.01" value={discount}
                                onChange={(e) => setDiscount(e.target.value)} data-testid="caja-descuento" />
                            {d > 0 && (
                                <>
                                    <label style={{ marginTop: 8 }}>Motivo del descuento</label>
                                    <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)}
                                        placeholder="Ej. cortesia de la casa" data-testid="caja-descuento-motivo" />
                                </>
                            )}
                        </div>
                    )}
                    {!canDiscount && <div className="discount-fields"><span className="muted" style={{ fontSize: 12 }}>Sin permiso de descuento</span></div>}

                    {/* Tip data-testid for backwards compat */}
                    <input type="hidden" value={tip} data-testid="caja-propina" readOnly />

                    {/* Total Row */}
                    <div className="total-row">
                        <div>
                            <span className="total-label">{payMode === 'all' ? 'Total' : 'Total a cobrar'}</span>
                        </div>
                        <output className="total-amount amount" data-testid="caja-total">{fmtMoney(chargeAmount || total)}</output>
                    </div>
                </section>

                {/* Payment Panel */}
                <section className="payment-panel" aria-label="Datos y registro del pago">
                    {/* Pay Hero */}
                    <div className="pay-hero">
                        <div>
                            <small>{result ? 'Total pagado' : payMode === 'equal' ? 'Parte por cobrar' : 'Por cobrar'}</small>
                            <output className="amount">{fmtMoney(chargeAmount)}</output>
                        </div>
                    </div>

                    {/* Method heading */}
                    <div className="method-heading">
                        <h2 className="section-heading">Metodo de pago</h2>
                    </div>

                    {/* Method Rail */}
                    <div className="method-rail-wrap">
                        <div className="method-rail" role="tablist">
                            {METHODS.map((m, i) => (
                                <button key={m.id} className="method" role="tab" data-method={m.id}
                                    data-testid={`caja-metodo-${METHOD_MAP[m.id]}`}
                                    aria-selected={method === m.id}
                                    disabled={Boolean(proofIntent && !proofSent)}
                                    onClick={() => {
                                        if (m.id !== method && !proofIntent && !proofSent && acct.payment_status !== 'comprobante_subido') {
                                            setSelectedProof('');
                                        }
                                        setMethod(m.id);
                                    }}>
                                    <kbd aria-hidden="true">{i + 1}</kbd>
                                    <m.Icon style={{ width: 23, height: 23 }} />
                                    <span>{m.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Payment Details */}
                    <div className="payment-card" data-tone={walletMethod ? 'wallet' : 'neutral'}>
                        <h3 className="card-heading">
                            {method === 'cash' ? 'Recibir efectivo' : walletMethod ? 'Cuenta receptora' : method === 'card' ? 'Pago en terminal' : method === 'transfer' ? 'Datos de transferencia' : 'Distribuir el pago'}
                        </h3>
                        {walletMethod && (
                            <button className="help-button" onClick={() => setShowHelp(true)} aria-label="Ayuda" title="Ayuda">
                                <HelpCircle style={{ width: 19, height: 19 }} />
                            </button>
                        )}

                        {/* WALLET PANEL (yape/plin) */}
                        {walletMethod && canSubmitProof && (
                            <section data-testid="caja-comprobante-pago">
                                {collectionConfigError ? (
                                    <p role="status" className="stale-error">No se pudo cargar la configuración. Cierre y vuelva a abrir este diálogo.</p>
                                ) : !collectionConfig ? (
                                    <p className="neutral-copy">Cargando opciones de pago…</p>
                                ) : !walletConfig?.enabled ? (
                                    <p role="status" className="neutral-copy">Este método no está habilitado para recibir comprobantes.</p>
                                ) : (
                                    <div className="account-layout">
                                        <div>
                                            {/^data:image\/(png|jpeg|webp);base64,/.test(walletConfig.qr || '') ? (
                                                <button className="qr-trigger" aria-label={`Código QR de ${PAYMENT_LABELS[backendMethod]}`}>
                                                    <img src={walletConfig.qr} alt={`Código QR de ${PAYMENT_LABELS[backendMethod]}`} data-testid={`caja-${backendMethod}-qr`} />
                                                </button>
                                            ) : (
                                                <p className="qr-caption">No hay código QR configurado para este método.</p>
                                            )}
                                        </div>
                                        <dl className="account-data">
                                            {walletConfig.number && (
                                                <div className="data-row">
                                                    <dt>Numero</dt>
                                                    <dd className="account-number">{walletConfig.number}</dd>
                                                    <button className="copy-button" onClick={() => copyText(walletConfig.number, 'Numero')} aria-label="Copiar numero">
                                                        <Copy style={{ width: 17, height: 17 }} />
                                                    </button>
                                                </div>
                                            )}
                                            {walletConfig.holder && (
                                                <div className="data-row">
                                                    <dt>Titular</dt>
                                                    <dd>{walletConfig.holder}</dd>
                                                    <button className="copy-button" onClick={() => copyText(walletConfig.holder, 'Titular')} aria-label="Copiar titular">
                                                        <Copy style={{ width: 17, height: 17 }} />
                                                    </button>
                                                </div>
                                            )}
                                        </dl>
                                    </div>
                                )}
                                {walletConfig?.enabled && !proofAlreadySent && (
                                    <div className="proof-section">
                                        <PaymentProofCapture
                                            key={`${acct.id}:${backendMethod}`}
                                            proof={selectedProof}
                                            onProof={setSelectedProof}
                                            disabled={proofSending || Boolean(proofIntent)}
                                            active={open && canSubmitProof && walletMethod}
                                        />
                                        {proofError && <p role="alert" className="stale-error" data-testid="caja-comprobante-error">{proofError}</p>}
                                        {proofIntent && !proofSent && <p className="file-hint">Se conservará la imagen y el método para reintentar el mismo envío.</p>}
                                        <button type="button" className="primary-button" onClick={submitProof} disabled={!selectedProof || proofSending || proofSent} data-testid="caja-enviar-comprobante">
                                            {proofSending ? 'Enviando…' : proofIntent ? 'Reintentar envío del comprobante' : 'Enviar comprobante para revisión'}
                                        </button>
                                    </div>
                                )}
                            </section>
                        )}
                        {walletMethod && !canSubmitProof && (
                            <p className="neutral-copy">Registra el pago solo después de verificar el ingreso. Este usuario no envía comprobantes.</p>
                        )}

                        {/* CASH PANEL */}
                        {method === 'cash' && (
                            <div className="cash-fields">
                                <label>Efectivo recibido</label>
                                <div className="currency-input">
                                    <span>S/</span>
                                    <input type="text" inputMode="decimal" value={received} placeholder={chargeAmount.toFixed(2)}
                                        onChange={(e) => setReceived(e.target.value)}
                                        data-testid="caja-recibido-input" aria-label="Efectivo recibido" />
                                </div>
                                <div className="preset-cash">
                                    <button onClick={() => handlePreset('exact')}>Exacto</button>
                                    <button onClick={() => handlePreset(2000)}>S/ 20</button>
                                    <button onClick={() => handlePreset(5000)}>S/ 50</button>
                                    <button onClick={() => handlePreset(10000)}>S/ 100</button>
                                </div>
                                <div className="change-row">
                                    <span>Vuelto</span>
                                    <strong className="amount" data-testid="caja-vuelto">{fmtMoney(change)}</strong>
                                </div>
                            </div>
                        )}

                        {/* CARD PANEL */}
                        {method === 'card' && (
                            <div>
                                <p className="neutral-copy">Registra el cobro aprobado en tu POS. No ingreses el numero de la tarjeta ni su codigo de seguridad.</p>
                                <div className="terminal-fields">
                                    <label>Referencia de operacion <span className="optional">· Opcional</span></label>
                                    <input className="text-input" maxLength={60} placeholder="Ej. codigo de operacion" value={cardRef} onChange={(e) => setCardRef(e.target.value)} />
                                </div>
                            </div>
                        )}

                        {/* TRANSFER PANEL */}
                        {method === 'transfer' && (
                            <div className="transfer-data">
                                <dl className="account-data">
                                    <div className="data-row"><dt>Banco</dt><dd>Banco de muestra</dd></div>
                                    <div className="data-row"><dt>Cuenta / CCI</dt><dd>Configura los datos de tu negocio</dd></div>
                                    <div className="data-row"><dt>Titular</dt><dd>Sabor Peruano S.A.C.</dd></div>
                                </dl>
                            </div>
                        )}

                        {/* MIXED PANEL */}
                        {method === 'mixed' && (
                            <div>
                                <p className="neutral-copy">Combina varios metodos. El ultimo metodo completa el total.</p>
                                {splits.map((s, idx) => {
                                    const isLast = idx === splits.length - 1;
                                    const usedMethods = splits.map(l => l.method);
                                    return (
                                        <div key={idx} className="mixed-line">
                                            <select value={s.method} onChange={(e) => { const c = [...splits]; c[idx] = { ...c[idx], method: e.target.value }; setSplits(c); }}
                                                data-testid={`caja-metodo-${METHOD_MAP[s.method] || s.method}`}
                                                aria-label={`Metodo ${idx + 1}`}>
                                                {METHODS.filter(m => m.id !== 'mixed').map(m => (
                                                    <option key={m.id} value={m.id} disabled={m.id !== s.method && usedMethods.includes(m.id)}>{m.name}</option>
                                                ))}
                                            </select>
                                            {isLast ? (
                                                <output className="mixed-auto amount">{fmtMoney(Math.max(0, mixedData().rest))}</output>
                                            ) : (
                                                <div className="currency-input">
                                                    <span>S/</span>
                                                    <input type="text" inputMode="decimal" value={s.amount} placeholder="0.00"
                                                        onChange={(e) => { const c = [...splits]; c[idx] = { ...c[idx], amount: e.target.value }; setSplits(c); }}
                                                        data-testid={`caja-split-${idx}-amount`} aria-label={`Importe metodo ${idx + 1}`} />
                                                </div>
                                            )}
                                            <button className="icon-button" onClick={() => { if (splits.length > 2) { const c = splits.filter((_, i) => i !== idx); setSplits(c); } }}
                                                disabled={splits.length <= 2} aria-label="Quitar metodo">
                                                <X style={{ width: 17, height: 17 }} />
                                            </button>
                                        </div>
                                    );
                                })}
                                <div className="mixed-bar" aria-hidden="true">
                                    <i style={{ width: `${chargeAmount ? Math.min(100, Math.round(splitsTotal / chargeAmount * 100)) : 0}%` }} />
                                </div>
                                <p className="mixed-note">Asignado {fmtMoney(Math.min(splitsTotal, chargeAmount))} de {fmtMoney(chargeAmount)}</p>
                                <button className="secondary-button mixed-add" type="button"
                                    disabled={splits.length >= 5}
                                    onClick={() => {
                                        const used = splits.map(l => l.method);
                                        const free = METHODS.find(m => m.id !== 'mixed' && !used.includes(m.id));
                                        if (!free) return;
                                        setSplits([...splits, { method: free.id, amount: '' }]);
                                    }}>
                                    + Agregar otro metodo
                                </button>
                            </div>
                        )}

                        {/* Proof Section — card/transfer stay local; Yape/Plin use the reviewed upload above */}
                        {showLocalProof && (
                            <div className="proof-section">
                                <p className="proof-title">Comprobante <span className="optional">· Opcional</span></p>
                                <div className="proof-actions">
                                    <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                                        <Image style={{ width: 18, height: 18 }} />
                                        <span>Adjuntar imagen</span>
                                    </button>
                                    <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                                        <Camera style={{ width: 18, height: 18 }} />
                                        <span>Tomar foto</span>
                                    </button>
                                </div>
                                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFileChange} />
                                <p className="file-hint">PNG, JPG o WebP · Maximo 1,8 MB</p>
                                {proofUrl && (
                                    <div className="proof-preview">
                                        <img className="proof-thumbnail" src={proofUrl} alt="Vista previa" />
                                        <div className="proof-info">
                                            <p className="proof-name">{proofFile?.name}</p>
                                            <p className="proof-state">Adjunto local · Sin enviar</p>
                                        </div>
                                        <button className="icon-button proof-remove" onClick={removeProof} aria-label="Quitar comprobante">
                                            <X style={{ width: 17, height: 17 }} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {(acct.payment_status === 'comprobante_subido' || proofSent) && (
                        <div className="proof-section" data-testid="caja-comprobante-pendiente">
                            <p className="proof-state" data-testid="caja-comprobante-enviado">
                                Comprobante {proofSent ? 'enviado' : 'pendiente'} para {PAYMENT_LABELS[proofIntent?.method || acct.payment_proof_method] || 'Yape o Plin'}; está pendiente de verificación.
                            </p>
                            {(proofIntent?.payment_proof || acct.payment_proof_url) && (
                                <img src={proofIntent?.payment_proof || acct.payment_proof_url} alt="Comprobante enviado" className="proof-thumbnail" />
                            )}
                            {proofRefreshPending && (
                                <div>
                                    <p role="alert" className="stale-error">{proofRefreshError}</p>
                                    <button type="button" className="secondary-button" onClick={retryOrderRefresh} data-testid="caja-recargar-orden">Actualizar cuenta</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Payment Note */}
                    {method !== 'cash' && (
                        <p className="payment-note">
                            <Info style={{ width: 14, height: 14 }} />
                            <span>Una imagen <strong>no confirma</strong> el ingreso del dinero.</span>
                        </p>
                    )}

                    {/* Payment History */}
                    <div className="payment-history">
                        {paid > 0 && (
                            <div className="history-title">
                                <strong>Movimientos de la cuenta</strong>
                                <button onClick={() => setShowHistory(true)}>Ver detalle</button>
                            </div>
                        )}
                        <div className="history-sums">
                            <div>Pagado<strong className="amount">{fmtMoney(paid)}</strong></div>
                            <div>Saldo de la cuenta<strong className="amount">{fmtMoney(remaining)}</strong></div>
                        </div>
                    </div>

                    {/* Success Inline */}
                    {result && (
                        <>
                            <div className="success-inline" data-testid="caja-pago-ok">
                                <CheckCircle2 style={{ width: 18, height: 18 }} />
                                <span>{result.fully_paid ? 'Cuenta pagada.' : `Pago parcial registrado. Restante: ${fmtMoney(result.remaining)}`}</span>
                            </div>
                            {result.change_amount > 0 && (
                                <div className="change-row" style={{ marginTop: 8 }}>
                                    <span>Entregar vuelto</span>
                                    <strong className="amount">{fmtMoney(result.change_amount)}</strong>
                                </div>
                            )}
                            <div className="receipt-actions">
                                <button className="secondary-button" onClick={doPrint} data-testid="caja-imprimir">
                                    <Printer style={{ width: 18, height: 18 }} /> Imprimir recibo
                                </button>
                                {result.fully_paid ? (
                                    <button className="secondary-button" onClick={() => { onOpenChange(false); setResult(null); }} data-testid="caja-siguiente">
                                        Siguiente cuenta
                                    </button>
                                ) : (
                                    <button className="secondary-button" onClick={() => {
                                        setResult(null); setPayMode('all'); setPicked({});
                                        setReceived(''); setNetError(false); setStale(null);
                                        idempotencyRef.current = newIdempotencyKey();
                                    }} data-testid="caja-cobrar-resto">
                                        Cobrar el resto
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    {/* Errors */}
                    {netError && (
                        <div className="net-error" data-testid="caja-red-error">
                            Se corto la conexion. El pago puede haberse registrado. No inicies otro cobro: reintentá esta misma operacion.
                        </div>
                    )}
                    {stale && (
                        <div className="stale-error" data-testid="caja-cuenta-cambio">
                            {stale.message || 'La cuenta cambio mientras la revisabas.'}
                            {stale.new_total != null && <div style={{ marginTop: 4 }}>Nuevo total: {fmtMoney(stale.new_total)}</div>}
                        </div>
                    )}
                </section>
            </div>

            {/* Footer */}
            <footer className="cobro-checkout-footer">
                <span className="footer-caption">
                    <Info style={{ width: 14, height: 14 }} />
                    <span>{footerNote() || 'Cobro POS · No procesa pagos reales'}</span>
                </span>
                <div className="footer-actions">
                    <button className="cancel-button" onClick={() => onOpenChange(false)}>Cancelar</button>
                    <button className="primary-button" onClick={handleRegister}
                        disabled={proofRefreshPending || loading || (!result && !canRegister())}
                        data-testid="caja-cobrar-submit-button">
                        <CheckCircle2 style={{ width: 19, height: 19 }} />
                        <span>{loading ? 'Registrando...' : (netError ? 'Reintentar el mismo cobro' : registerLabel())}</span>
                    </button>
                </div>
            </footer>

            {/* Verify Dialog */}
            {showVerify && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', background: '#0b0e1366' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowVerify(false); }}>
                    <div role="dialog" aria-modal="true" style={{ position: 'relative', border: '1px solid var(--line)', background: 'var(--paper)', padding: 0, borderRadius: 20, width: 'min(420px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 40px)', color: 'var(--ink)', font: '14px/1.5 var(--font)', overflow: 'auto', boxShadow: '0 18px 90px #3027213d' }}>
                        <header className="dialog-header">
                            <h2>Verificar antes de registrar</h2>
                            <button className="icon-button" onClick={() => setShowVerify(false)} aria-label="Cerrar">
                                <X style={{ width: 20, height: 20 }} />
                            </button>
                        </header>
                        <div className="dialog-body">
                            <div className="confirm-summary">
                                <div>
                                    <div className="muted">Importe de este cobro</div>
                                    <div className="confirm-method">{METHODS.find(m => m.id === method)?.name}</div>
                                </div>
                                <strong className="amount">{fmtMoney(chargeAmount)}</strong>
                            </div>
                            <label className="confirm-check">
                                <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="caja-verificar-check" />
                                <span>{verifyCopy}</span>
                            </label>
                            <p className="confirm-warning">{verifyWarning}</p>
                        </div>
                        <footer className="dialog-actions">
                            <button className="cancel-button" onClick={() => setShowVerify(false)}>Volver</button>
                            <button className="primary-button" disabled={!verified} onClick={handleConfirm} data-testid="caja-verificar-registrar">Registrar</button>
                        </footer>
                    </div>
                </div>
            )}

            {/* Help Dialog */}
            {showHelp && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', background: '#0b0e1366' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
                    <dialog open style={{ position: 'relative', border: '1px solid var(--line)', background: 'var(--paper)', padding: 0, borderRadius: 20, width: 'min(420px, calc(100vw - 32px))', color: 'var(--ink)', font: '14px/1.5 var(--font)', overflow: 'auto', boxShadow: '0 18px 90px #3027213d' }}>
                        <header className="dialog-header">
                            <h2>Como registrar este cobro</h2>
                            <button className="icon-button" onClick={() => setShowHelp(false)} aria-label="Cerrar ayuda">
                                <X style={{ width: 20, height: 20 }} />
                            </button>
                        </header>
                        <div className="dialog-body">
                            <ol className="help-steps">
                                <li><strong>Muestra los datos de pago</strong>El cliente puede escanear el QR o usar el numero.</li>
                                <li><strong>Adjunta un respaldo, si lo necesitas</strong>Puedes subir una imagen o tomar una foto.</li>
                                <li><strong>Verifica y registra</strong>Comprueba el movimiento en la cuenta receptora. Luego registra el pago.</li>
                            </ol>
                        </div>
                    </dialog>
                </div>
            )}

            {/* History Dialog */}
            {showHistory && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', background: '#0b0e1366' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowHistory(false); }}>
                    <dialog open style={{ position: 'relative', border: '1px solid var(--line)', background: 'var(--paper)', padding: 0, borderRadius: 20, width: 'min(420px, calc(100vw - 32px))', color: 'var(--ink)', font: '14px/1.5 var(--font)', overflow: 'auto', boxShadow: '0 18px 90px #3027213d' }}>
                        <header className="dialog-header">
                            <h2>Movimientos de la cuenta</h2>
                            <button className="icon-button" onClick={() => setShowHistory(false)} aria-label="Cerrar">
                                <X style={{ width: 20, height: 20 }} />
                            </button>
                        </header>
                        <div className="dialog-body">
                            <div className="history-sums" style={{ marginBottom: 12 }}>
                                <div>Pagado<strong className="amount">{fmtMoney(paid)}</strong></div>
                                <div>Restante<strong className="amount">{fmtMoney(remaining)}</strong></div>
                            </div>
                            <p className="help-small">Los movimientos se muestran en el historial de pagos.</p>
                        </div>
                    </dialog>
                </div>
            )}

            {/* Toast */}
            {toastMsg && <div className="cobro-toast show">{toastMsg}</div>}
        </div>
        </div>
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
                                    {o.payment_status === 'pagado' ? <div className="text-xs text-primary mt-1">Pagado · sigue en cocina</div> : <Button size="sm" className="mt-1 h-10" onClick={() => setPendingOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>}
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
                                    {o.payment_status === 'pagado' ? <div className="text-xs text-primary mt-1">Pagado · sigue en cocina</div> : <Button size="sm" className="mt-1 h-10" onClick={() => setPendingOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>}
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