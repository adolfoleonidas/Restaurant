import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { fmtMoney, PAYMENT_LABELS } from '@/lib/format';
import { Banknote, Smartphone, CreditCard, Building2, ArrowLeftRight, CheckCircle2, Printer, Copy, Info, Lock, HelpCircle, X, ChevronDown, Maximize2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { printCajaReceipt } from '@/lib/printReceipt';
import { accountLabel, equalShare, newIdempotencyKey, parseAmount, round2 } from '@/lib/cash';
import PaymentProofCapture from '@/components/PaymentProofCapture';
import '@/styles/cobro.css';

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
const TIP_CHIPS = [0, 5, 10, 15];
const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];

function mediaMatches(query) {
    return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

export default function CobrarDialog({ open, onOpenChange, order, onPaid }) {
    const { user } = useAuth();
    const canDiscount = user?.role === 'admin' || !!user?.can_discount;
    const canSubmitProof = user?.role === 'admin' || user?.role === 'cajero'
        || user?.functions?.includes('cobro') || user?.functions?.includes('administracion');

    // Detect mobile viewport / coarse pointer for responsive defaults (guarded for jsdom)
    const [isMobile, setIsMobile] = useState(() => (typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 760px)').matches
        : window.innerWidth <= 760));
    const [coarsePointer, setCoarsePointer] = useState(() => mediaMatches('(pointer: coarse)'));
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const mq = window.matchMedia('(max-width: 760px)');
        const handler = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const mq = window.matchMedia('(pointer: coarse)');
        const handler = (e) => setCoarsePointer(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

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
    const [detailOpen, setDetailOpen] = useState(() => window.innerWidth > 760);
    const [showVerify, setShowVerify] = useState(false);
    const [verified, setVerified] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine !== false);
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
            setLive(order); setDetailOpen(window.innerWidth > 760); setShowVerify(false); setVerified(false);
            setShowHelp(false); setShowHistory(false); setShowQr(false); setCardRef('');
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

    useEffect(() => {
        const sync = () => setOnline(navigator.onLine !== false);
        window.addEventListener('online', sync);
        window.addEventListener('offline', sync);
        return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
    }, []);

    // Number-key shortcuts (1-6) like the prototype: ignored while typing or when a sub-dialog is open.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
            if (showVerify || showHelp || showHistory || showQr) return;
            const idx = Number(e.key);
            if (!Number.isInteger(idx) || idx < 1 || idx > METHODS.length) return;
            if (proofIntent && !proofSent) return; // method rail is locked mid-proof-send
            e.preventDefault();
            const next = METHODS[idx - 1].id;
            if (next !== method && !proofIntent && !proofSent && (live || order)?.payment_status !== 'comprobante_subido') {
                setSelectedProof('');
            }
            setMethod(next);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, showVerify, showHelp, showHistory, showQr, method, proofIntent, proofSent, live, order]);

    if (!open) return null;
    const acct = live || order;
    if (!acct) return null;

    // Computed values
    const subtotal = acct.subtotal || 0;
    const fee = Number(acct.delivery_fee || 0);
    const d = Number(discount || acct.discount || 0);
    const tipInvalid = tip.trim() !== '' && parseAmount(tip) === null;
    const tipVal = parseAmount(tip, true) || 0;
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
    const r = parseAmount(received);
    const change = method === 'cash' ? Math.max(0, (r || 0) - chargeAmount) : 0;
    const splitsTotal = splits.reduce((s, x) => s + (parseAmount(x.amount, true) || 0), 0);
    const cashError = received.trim() !== '' && r === null
        ? 'Ingresa un importe válido.'
        : r !== null && chargeAmount > 0 && r < chargeAmount
            ? `Faltan ${fmtMoney(round2(chargeAmount - r))} para completar este cobro.`
            : '';
    const scopeCaption = payMode === 'items'
        ? (unpaidItems.length ? `${pickedLines.length} de ${unpaidItems.length} ítems` : 'Selecciona al menos un ítem')
        : payMode === 'equal'
            ? `Parte ${part + 1} de ${people}`
            : '';

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
            const amt = parseAmount(l.amount);
            if (amt === null || amt <= 0) { ok = false; if (l.amount) error = 'Cada importe debe ser mayor que cero (máximo 2 decimales).'; }
            else sum += amt;
            return { method: METHOD_MAP[l.method] || l.method, cents: amt || 0 };
        });
        const rest = round2(due - sum);
        lines[n - 1].cents = rest;
        const usedMethods = ls.map(l => l.method);
        if (new Set(usedMethods).size !== n) { ok = false; error = 'Elige un método distinto en cada línea.'; }
        if (rest <= 0) { ok = false; if (!error && ls.slice(0, -1).every(l => l.amount)) error = 'Los importes ya cubren el total. El último método necesita un saldo.'; }
        return { lines, sum, rest, due, valid: ok && due > 0, error };
    };
    const md = mixedData();

    // Can register?
    const canRegister = () => {
        if (!online) return false;
        if (tipInvalid) return false;
        if (chargeAmount <= 0) return false;
        // Cash with an empty field means "exact": the payload already defaults
        // received_amount to the charge, so the cashier is never stuck.
        if (method === 'cash') return !received.trim() || (r !== null && r >= chargeAmount);
        if (method === 'mixed') return md.valid;
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
                payload.splits = md.lines.filter((s) => s.cents > 0).map((s) => ({ method: s.method, amount: s.cents }));
            }
            if (payMode === 'items' && pickedLines.length) {
                payload.lines = pickedLines.map((l) => ({ item_id: l.item_id, quantity: l.quantity }));
            }
            const { data } = await api.post('/payments', payload);
            setResult(data);
            setNetError(false);
            try {
                navigator.vibrate?.(data.fully_paid ? [40, 30, 40] : 30);
            } catch { /* haptics are best-effort */ }
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

    const selectMethod = (next) => {
        if (next !== method && !proofIntent && !proofSent && acct.payment_status !== 'comprobante_subido') {
            setSelectedProof('');
        }
        setMethod(next);
    };

    const legacyCopy = (text) => {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.append(field);
        field.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        field.remove();
        return ok;
    };

    const copyText = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            showToast(label + ' copiado');
        } catch {
            showToast(legacyCopy(text)
                ? label + ' copiado'
                : 'El navegador no permitió copiar. Selecciona y copia el dato manualmente.');
        }
    };

    // Tip chips
    const handleTipChip = (pct) => {
        setTipPct(pct);
        if (pct === 0) { setTip(''); }
        else { setTip(String(round2(baseTotal * pct / 100))); }
    };

    // Preset cash
    const handlePreset = (val) => {
        if (val === 'exact') setReceived(chargeAmount.toFixed(2));
        else setReceived((val / 100).toFixed(2));
    };

    // On-screen keypad for coarse pointers (phones/tablets without keyboard)
    const handleKeypadPress = (key) => {
        let v = received;
        if (key === '⌫') v = v.slice(0, -1);
        else if (key === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
        else v += key;
        if (/^\d{0,6}(\.\d{0,2})?$/.test(v)) setReceived(v);
    };

    // Verify dialog copy
    const verifyCopy = method === 'cash'
        ? 'Recibí el efectivo y comprobé el vuelto.'
        : method === 'card'
            ? 'Comprobé que el POS aprobó este cobro.'
            : method === 'mixed'
                ? 'Verifiqué todos los pagos y recibí el efectivo, si corresponde.'
                : 'Verifiqué el ingreso en la cuenta receptora.';

    const verifyWarning = method === 'cash'
        ? 'El importe registrado corresponde al cobro, no al efectivo entregado por el cliente.'
        : method === 'mixed'
            ? 'Todos los componentes se registrarán juntos.'
            : 'Confirmación manual. Adjuntar una imagen no verifica automáticamente el pago.';

    const verifyContext = () => {
        if (method === 'cash' && r !== null) return `Recibido: ${fmtMoney(r)} · Vuelto: ${fmtMoney(change)}`;
        if (method === 'mixed') return md.lines.map((l) => `${PAYMENT_LABELS[l.method] || l.method}: ${fmtMoney(Math.max(0, l.cents))}`).join(' · ');
        return '';
    };

    // Register button label
    const registerLabel = () => {
        if (result) return 'Finalizar';
        const amt = method !== 'mixed' && chargeAmount > 0 ? ` · ${fmtMoney(chargeAmount)}` : '';
        if (method === 'cash') return 'Registrar efectivo' + amt;
        return (isMobile ? 'Registrar pago' : 'Registrar pago verificado') + amt;
    };

    // Footer note
    const footerNote = () => {
        if (!online) return 'Sin conexión: reconecta para registrar';
        if (result) return '';
        if (tipInvalid) return 'Corrige la propina para continuar';
        if (!canRegister()) {
            if (method === 'cash' && !r) return 'Monto exacto · escribí el efectivo recibido si te dan un billete mayor';
            if (method === 'cash' && r < chargeAmount) return 'El efectivo recibido no cubre el total';
            if (method === 'mixed') return 'Completa los montos del pago mixto';
            if (chargeAmount <= 0) return 'Selecciona al menos un ítem';
        }
        return '';
    };

    const walletMethod = method === 'yape' || method === 'plin';
    const walletConfig = collectionConfig?.[backendMethod];
    const proofAlreadySent = acct.payment_status === 'comprobante_subido' || proofSent;

    return (
        <div className="cobro-overlay" onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}>
        <div className="cobro-checkout" data-testid="caja-cobrar-dialog" role="dialog" aria-labelledby="checkout-title">
            {!online && <div className="offline-banner" role="status">Sin conexión. Reconecta para registrar pagos.</div>}
            {/* Header */}
            <header className="cobro-checkout-header">
                <span className="table-mark" aria-hidden="true"><CreditCard style={{ width: 26, height: 26 }} /></span>
                <div>
                    <h1 id="checkout-title">{accountLabel(acct)}</h1>
                    <div className="header-meta">
                        {acct.attention_number ? (
                            <>
                                <span>Atención {acct.attention_number}</span>
                                <span className="dot" />
                            </>
                        ) : null}
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
                                        <input type="text" inputMode="decimal" value={tip} placeholder="Otro monto" maxLength={9}
                                            onChange={(e) => { setTip(e.target.value); setTipPct(0); }}
                                            aria-label="Otro monto de propina" />
                                    </div>
                                ) : (
                                    <span className="amount">{fmtMoney(tipVal)}</span>
                                )}
                            </div>
                            {payMode === 'all' && (
                                <div className="tip-chips" role="group" aria-label="Propina por porcentaje">
                                    {TIP_CHIPS.map((pct) => (
                                        <button key={pct} className="tip-chip" aria-pressed={pct === 0 ? (!tip && tipPct === 0) : (tipPct === pct)}
                                            onClick={() => handleTipChip(pct)}>
                                            {pct ? `${pct}%` : 'Sin propina'}
                                            {pct > 0 && <small>{fmtMoney(round2(baseTotal * pct / 100))}</small>}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {tipInvalid && <p role="status" className="field-error">Usa un importe positivo con máximo 2 decimales.</p>}
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
                            {scopeCaption && <span className="total-caption">{scopeCaption}</span>}
                        </div>
                        <output className="total-amount amount" data-testid="caja-total" aria-live="polite" aria-label="Total a cobrar">{fmtMoney(chargeAmount || total)}</output>
                    </div>
                </section>

                {/* Payment Panel */}
                <section className="payment-panel" aria-label="Datos y registro del pago">
                    {/* Pay Hero */}
                    <div className="pay-hero">
                        <div>
                            <small>{result ? 'Total pagado' : payMode === 'equal' ? 'Parte por cobrar' : 'Por cobrar'}</small>
                            <output className="amount" aria-live="polite">{fmtMoney(chargeAmount)}</output>
                        </div>
                        {scopeCaption && <span className="cap">{scopeCaption}</span>}
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
                                    onClick={() => selectMethod(m.id)}>
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
                                                <>
                                                    <button className="qr-trigger" aria-haspopup="dialog"
                                                        aria-label={`Ampliar código QR de ${PAYMENT_LABELS[backendMethod]}`}
                                                        onClick={() => setShowQr(true)}>
                                                        <img src={walletConfig.qr} alt={`Código QR de ${PAYMENT_LABELS[backendMethod]}`} data-testid={`caja-${backendMethod}-qr`} />
                                                        <span className="qr-expand" aria-hidden="true"><Maximize2 style={{ width: 16, height: 16 }} /></span>
                                                    </button>
                                                    <p className="qr-caption">Toca para ampliar</p>
                                                </>
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
                                    <input type="text" inputMode={coarsePointer ? 'none' : 'decimal'} value={received} placeholder={chargeAmount.toFixed(2)}
                                        onChange={(e) => setReceived(e.target.value)}
                                        data-testid="caja-recibido-input" aria-label="Efectivo recibido" />
                                </div>
                                {coarsePointer && (
                                    <div className="keypad" role="group" aria-label="Teclado numérico de efectivo">
                                        {KEYPAD_KEYS.map((k) => (
                                            <button key={k} type="button" onClick={() => handleKeypadPress(k)}
                                                aria-label={k === '⌫' ? 'Borrar' : k === '.' ? 'Punto decimal' : k}>
                                                {k}
                                            </button>
                                        ))}
                                    </div>
                                )}
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
                                {cashError && <p role="status" className="field-error">{cashError}</p>}
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
                                                <output className="mixed-auto amount" aria-label={`Resto a cobrar con el método ${idx + 1}`}>{fmtMoney(Math.max(0, md.rest))}</output>
                                            ) : (
                                                <div className="currency-input">
                                                    <span>S/</span>
                                                    <input type="text" inputMode="decimal" value={s.amount} placeholder="0.00" maxLength={9}
                                                        onChange={(e) => { const c = [...splits]; c[idx] = { ...c[idx], amount: e.target.value }; setSplits(c); }}
                                                        data-testid={`caja-split-${idx}-amount`} aria-label={`Importe metodo ${idx + 1}`} />
                                                </div>
                                            )}
                                            <button className="icon-button mixed-remove" onClick={() => { if (splits.length > 2) { const c = splits.filter((_, i) => i !== idx); setSplits(c); } }}
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
                                {md.error && <p role="status" className="field-error">{md.error}</p>}
                                <button className="secondary-button mixed-add" type="button"
                                    disabled={splits.length >= 5}
                                    onClick={() => {
                                        const used = splits.map(l => l.method);
                                        const free = METHODS.find(m => m.id !== 'mixed' && !used.includes(m.id));
                                        if (!free) return;
                                        // The current auto last line becomes a typed line: prefill a sensible half of the remainder.
                                        const prefill = String(Math.max(1, Math.floor(Math.max(0, md.rest) / 2)));
                                        const next = splits.map((l, i) => (i === splits.length - 1 ? { ...l, amount: l.amount || prefill } : l));
                                        setSplits([...next, { method: free.id, amount: '' }]);
                                    }}>
                                    + Agregar otro metodo
                                </button>
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
                            <div className="success-inline" data-testid="caja-pago-ok" role="status">
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
                    <span className={footerNote() ? 'footer-note why' : 'footer-note'}>{footerNote() || 'Caja POS · Verifica el pago antes de registrarlo'}</span>
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
                <div className="cobro-sub-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowVerify(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="verify-title" className="cobro-subdialog">
                        <header className="dialog-header">
                            <h2 id="verify-title">Verificar antes de registrar</h2>
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
                            {verifyContext() && <p className="verify-context">{verifyContext()}</p>}
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
                <div className="cobro-sub-overlay cobro-sheet" onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="help-title" className="cobro-subdialog">
                        <header className="dialog-header">
                            <h2 id="help-title">Cómo registrar este cobro</h2>
                            <button className="icon-button" onClick={() => setShowHelp(false)} aria-label="Cerrar ayuda">
                                <X style={{ width: 20, height: 20 }} />
                            </button>
                        </header>
                        <div className="dialog-body">
                            <ol className="help-steps">
                                <li><strong>Muestra los datos de pago</strong>El cliente puede escanear el QR desde su teléfono o usar el número. Toca el QR para ampliarlo.</li>
                                <li><strong>Adjunta un respaldo, si lo necesitas</strong>Puedes subir una imagen o tomar una foto. Enviarla a revisión no cambia el saldo de la cuenta.</li>
                                <li><strong>Verifica y registra</strong>Comprueba el movimiento en la cuenta receptora. Luego registra el pago. Una captura por sí sola no lo valida.</li>
                            </ol>
                        </div>
                    </div>
                </div>
            )}

            {/* QR Dialog */}
            {showQr && walletConfig?.qr && (
                <div className="cobro-sub-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowQr(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="qr-title" className="cobro-subdialog">
                        <header className="dialog-header">
                            <h2 id="qr-title">Código para mostrar al cliente</h2>
                            <button className="icon-button" onClick={() => setShowQr(false)} aria-label="Cerrar QR">
                                <X style={{ width: 20, height: 20 }} />
                            </button>
                        </header>
                        <div className="dialog-body">
                            <img className="qr-large" src={walletConfig.qr} alt={`Código QR de ${PAYMENT_LABELS[backendMethod]} ampliado`} />
                            {walletConfig.holder && <p className="qr-dialog-label">{walletConfig.holder}</p>}
                            {walletConfig.number && <p className="qr-dialog-number amount">{walletConfig.number}</p>}
                        </div>
                    </div>
                </div>
            )}

            {/* History Dialog */}
            {showHistory && (
                <div className="cobro-sub-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowHistory(false); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="history-title" className="cobro-subdialog">
                        <header className="dialog-header">
                            <h2 id="history-title">Movimientos de la cuenta</h2>
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
                    </div>
                </div>
            )}

            {/* Toast */}
            {toastMsg && <div className="cobro-toast show" role="status">{toastMsg}</div>}
        </div>
        </div>
    );
}
