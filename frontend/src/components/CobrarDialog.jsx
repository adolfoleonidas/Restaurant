import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { getOrder } from '@/lib/api/orders';
import { createPayment } from '@/lib/api/payments';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { ACTIONS, can } from '@/lib/permissions';
import { printCajaReceipt } from '@/lib/printReceipt';
import { accountLabel } from '@/lib/cash';
import { copyToClipboard } from '@/lib/clipboard';
import { isWalletMethod } from '@/lib/paymentMethods';
import { METHODS } from '@/components/cobro/constants';
import {
    footerNote as footerNoteFor,
    registerLabel as registerLabelFor,
    verifyContext as verifyContextFor,
    verifyCopy as verifyCopyFor,
    verifyWarning as verifyWarningFor,
} from '@/lib/paymentForm';
import usePaymentForm from '@/hooks/usePaymentForm';
import usePaymentProof from '@/hooks/usePaymentProof';
import CobroHeader from '@/components/cobro/CobroHeader';
import OrderPanel from '@/components/cobro/OrderPanel';
import PaymentPanel from '@/components/cobro/PaymentPanel';
import CobroFooter from '@/components/cobro/CobroFooter';
import VerifyDialog from '@/components/cobro/VerifyDialog';
import HelpDialog from '@/components/cobro/HelpDialog';
import QrDialog from '@/components/cobro/QrDialog';
import HistoryDialog from '@/components/cobro/HistoryDialog';
import '@/styles/cobro.css';

function mediaMatches(query) {
    return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

export default function CobrarDialog({ open, onOpenChange, order, onPaid }) {
    const { user } = useAuth();
    const canDiscount = can(user, ACTIONS.CASH_DISCOUNT);
    const canSubmitProof = can(user, ACTIONS.CASH_SUBMIT_PROOF);

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
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [stale, setStale] = useState(null);
    const [netError, setNetError] = useState(false);
    const [live, setLive] = useState(order);
    const [detailOpen, setDetailOpen] = useState(() => window.innerWidth > 760);
    const [showVerify, setShowVerify] = useState(false);
    const [verified, setVerified] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine !== false);
    const [toastMsg, setToastMsg] = useState('');
    const dialogRef = useRef(null);
    const lastFocusRef = useRef(null);

    // The form (method, amounts, split) and the wallet proof flow live in hooks;
    // the dialog keeps the request lifecycle and the screen state.
    const form = usePaymentForm({ acct: live || order, online });
    const proof = usePaymentProof({
        open,
        canSubmitProof,
        restaurantId: user?.restaurant_id,
        acct: live || order,
        backendMethod: form.backendMethod,
        onOrderRefreshed: setLive,
    });
    const {
        method, setMethod, received, setReceived, discount, setDiscount, discountReason, setDiscountReason,
        tip, setTip, tipPct, setTipPct, splits, payMode, setPayMode, people, setPeople, part, setPart,
        picked, setPicked, cardRef, setCardRef, md, splitsTotal, scopeCaption, backendMethod, canRegister,
        handleTipChip, handlePreset, quickCash, handleKeypadPress, updateSplit, removeSplit, addSplit, canAddSplit,
    } = form;
    const {
        d, tipInvalid, tipVal, baseTotal, total, paid, remaining, pickedLines, itemsAmount, partsN, chargeAmount,
    } = form.charge;
    const { r, change, cashError } = form.cash;
    const {
        collectionConfig, collectionConfigError, selectedProof, setSelectedProof, proofIntent, proofSending, proofSent,
        proofError, proofRefreshPending, proofRefreshError, submitProof, retryOrderRefresh,
    } = proof;

    const showToast = useCallback((msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 4000);
    }, []);

    // Reset on open. A closed dialog advances the epoch so a late upload cannot land on the next account.
    useEffect(() => {
        if (open) {
            proof.resetProof();
            form.resetForm(order);
            setResult(null); setStale(null); setNetError(false);
            setLive(order); setDetailOpen(window.innerWidth > 760); setShowVerify(false); setVerified(false);
            setShowHelp(false); setShowHistory(false); setShowQr(false);
        } else {
            proof.invalidateProof();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, order?.id]);

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
            // Trampa de foco: el diálogo se comporta como modal de verdad. Se
            // atiende antes del filtro de campos para que Tab no escape al fondo
            // (que queda detrás del overlay).
            if (e.key === 'Tab') {
                const dialog = dialogRef.current;
                if (!dialog) return;
                const focusables = Array.from(dialog.querySelectorAll(
                    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )).filter((el) => el.getClientRects().length > 0);
                if (!focusables.length) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const current = document.activeElement;
                if (!dialog.contains(current)) {
                    e.preventDefault();
                    first.focus();
                } else if (e.shiftKey && current === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && current === last) {
                    e.preventDefault();
                    first.focus();
                }
                return;
            }
            if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
            if (showVerify || showHelp || showHistory || showQr) return;
            // Escape cierra el cobro, salvo que haya una operación en curso:
            // nunca se abandona el diálogo a mitad de un registro de pago.
            if (e.key === 'Escape') {
                if (loading || result || proofSending) return;
                e.preventDefault();
                onOpenChange(false);
                return;
            }
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
    }, [open, showVerify, showHelp, showHistory, showQr, method, proofIntent, proofSent, live, order, loading, result, proofSending, onOpenChange]);

    // El foco entra al diálogo al abrirlo y vuelve al botón que lo abrió al
    // cerrarlo (antes quedaba en el botón "Cobrar", que queda detrás del
    // overlay, y el foco se perdía en el documento).
    useEffect(() => {
        if (open) {
            lastFocusRef.current = document.activeElement;
            dialogRef.current?.focus();
        } else if (lastFocusRef.current && document.contains(lastFocusRef.current)) {
            lastFocusRef.current.focus();
        }
    }, [open]);

    if (!open) return null;
    const acct = live || order;
    if (!acct) return null;

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
            const { data } = await createPayment(form.buildPayload());
            setResult(data);
            setNetError(false);
            try {
                navigator.vibrate?.(data.fully_paid ? [40, 30, 40] : 30);
            } catch { /* haptics are best-effort */ }
            try {
                const fresh = await getOrder(acct.id);
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
                    toast.error(typeof detail === 'string' ? detail : (detail?.message || 'No se pudo registrar el pago. Revisá tu conexión y reintentá.'));
                    form.rotateIdempotencyKey();
                }
            }
        } finally { setLoading(false); }
    };

    const handleRegister = () => {
        if (result || proofRefreshPending) return;
        if (!canRegister) return;
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

    // After a partial payment: charge the rest of the account from scratch.
    const onChargeRest = () => {
        setResult(null); form.resetForRest(); setNetError(false); setStale(null);
    };

    const onNextAccount = () => { onOpenChange(false); setResult(null); };

    const copyText = async (text, label) => {
        const ok = await copyToClipboard(text);
        showToast(ok ? `${label} copiado` : 'El navegador no permitió copiar. Selecciona y copia el dato manualmente.');
    };

    const verifyCopy = verifyCopyFor(method);
    const verifyWarning = verifyWarningFor(method);
    const verifyContext = verifyContextFor({
        method, r, change, md,
    });
    const registerLabel = registerLabelFor({
        result, method, chargeAmount, isMobile,
    });
    const footerNote = footerNoteFor({
        online, result, tipInvalid, canRegister, method, r, chargeAmount,
    });

    const walletMethod = isWalletMethod(method);
    const walletConfig = collectionConfig?.[backendMethod];
    const proofAlreadySent = acct.payment_status === 'comprobante_subido' || proofSent;

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="cobro-overlay" onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }} />
        <DialogPrimitive.Content className="cobro-checkout" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" data-testid="caja-cobrar-dialog" aria-labelledby="checkout-title" onEscapeKeyDown={(e) => { if (loading || result || proofSending) e.preventDefault(); }}>
            {!online && <div className="offline-banner" role="status">Sin conexión. Reconecta para registrar pagos.</div>}
            {/* Header */}
            <CobroHeader
                acct={acct}
                onOpenChange={onOpenChange}
                paid={paid}
                result={result}
            />

            {/* Content */}
            <div className="cobro-checkout-content">
                {/* Order Panel */}
                <OrderPanel
                    acct={acct}
                    baseTotal={baseTotal}
                    canDiscount={canDiscount}
                    chargeAmount={chargeAmount}
                    d={d}
                    detailOpen={detailOpen}
                    discount={discount}
                    discountReason={discountReason}
                    handleTipChip={handleTipChip}
                    itemsAmount={itemsAmount}
                    part={part}
                    partsN={partsN}
                    payMode={payMode}
                    people={people}
                    picked={picked}
                    scopeCaption={scopeCaption}
                    setDetailOpen={setDetailOpen}
                    setDiscount={setDiscount}
                    setDiscountReason={setDiscountReason}
                    setPart={setPart}
                    setPayMode={setPayMode}
                    setPeople={setPeople}
                    setPicked={setPicked}
                    setTip={setTip}
                    setTipPct={setTipPct}
                    tip={tip}
                    tipInvalid={tipInvalid}
                    tipPct={tipPct}
                    tipVal={tipVal}
                    total={total}
                />

                {/* Payment Panel */}
                <PaymentPanel
                    acct={acct}
                    addSplit={addSplit}
                    backendMethod={backendMethod}
                    canAddSplit={canAddSplit}
                    canSubmitProof={canSubmitProof}
                    cardRef={cardRef}
                    cashError={cashError}
                    change={change}
                    chargeAmount={chargeAmount}
                    coarsePointer={coarsePointer}
                    collectionConfig={collectionConfig}
                    collectionConfigError={collectionConfigError}
                    copyText={copyText}
                    doPrint={doPrint}
                    handleKeypadPress={handleKeypadPress}
                    handlePreset={handlePreset}
                    quickCash={quickCash}
                    md={md}
                    method={method}
                    netError={netError}
                    onChargeRest={onChargeRest}
                    onNextAccount={onNextAccount}
                    open={open}
                    paid={paid}
                    payMode={payMode}
                    proofAlreadySent={proofAlreadySent}
                    proofError={proofError}
                    proofIntent={proofIntent}
                    proofRefreshError={proofRefreshError}
                    proofRefreshPending={proofRefreshPending}
                    proofSending={proofSending}
                    proofSent={proofSent}
                    received={received}
                    remaining={remaining}
                    removeSplit={removeSplit}
                    result={result}
                    retryOrderRefresh={retryOrderRefresh}
                    scopeCaption={scopeCaption}
                    selectMethod={selectMethod}
                    selectedProof={selectedProof}
                    setCardRef={setCardRef}
                    setReceived={setReceived}
                    setSelectedProof={setSelectedProof}
                    setShowHelp={setShowHelp}
                    setShowHistory={setShowHistory}
                    setShowQr={setShowQr}
                    splits={splits}
                    splitsTotal={splitsTotal}
                    stale={stale}
                    submitProof={submitProof}
                    updateSplit={updateSplit}
                    walletConfig={walletConfig}
                    walletMethod={walletMethod}
                />
            </div>

            {/* Footer */}
            <CobroFooter
                canRegister={canRegister}
                footerNote={footerNote}
                handleRegister={handleRegister}
                loading={loading}
                netError={netError}
                onOpenChange={onOpenChange}
                proofRefreshPending={proofRefreshPending}
                registerLabel={registerLabel}
                result={result}
            />

            {/* Verify Dialog */}
            {showVerify && (
                <VerifyDialog
                    chargeAmount={chargeAmount}
                    handleConfirm={handleConfirm}
                    method={method}
                    setShowVerify={setShowVerify}
                    setVerified={setVerified}
                    verified={verified}
                    verifyContext={verifyContext}
                    verifyCopy={verifyCopy}
                    verifyWarning={verifyWarning}
                />
            )}

            {/* Help Dialog */}
            {showHelp && (
                <HelpDialog
                    setShowHelp={setShowHelp}
                />
            )}

            {/* QR Dialog */}
            {showQr && walletConfig?.qr && (
                <QrDialog
                    backendMethod={backendMethod}
                    setShowQr={setShowQr}
                    walletConfig={walletConfig}
                />
            )}

            {/* History Dialog */}
            {showHistory && (
                <HistoryDialog
                    paid={paid}
                    remaining={remaining}
                    setShowHistory={setShowHistory}
                />
            )}

            {/* Toast */}
            {toastMsg && <div className="cobro-toast show" role="status">{toastMsg}</div>}
        </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
