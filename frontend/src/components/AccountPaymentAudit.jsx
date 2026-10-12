import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fmtMoney, PAYMENT_LABELS } from '@/lib/format';
import { PAYMENT_RECORD_STATUS_LABELS, ORDER_PAYMENT_LABELS } from '@/constants/status';

const EMPTY_SCOPE_PARAMS = {};
const PAYMENT_STATUSES = new Set(['completed', 'voiding', 'voided', 'refunded']);
const ORDER_PAYMENT_STATUSES = new Set([
    'pendiente', 'parcial', 'pagado', 'comprobante_subido', 'confirmado', 'cancelado', 'anulado', 'voided', 'refunded',
]);
const PAYMENT_METHODS = new Set(['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'mixto']);

function isAmount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validDate(value) {
    return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function inspectAudit(orderId, order, payments) {
    if (!order || typeof order !== 'object' || Array.isArray(order) || order.id !== orderId
        || !isAmount(order.total)) return { status: 'unverified' };
    const paidValue = Object.prototype.hasOwnProperty.call(order, 'amount_paid') ? order.amount_paid : 0;
    if (!isAmount(paidValue)) return { status: 'unverified' };
    const paymentStatus = Object.prototype.hasOwnProperty.call(order, 'payment_status')
        ? order.payment_status : (paidValue === 0 ? 'pendiente' : null);
    if (!ORDER_PAYMENT_STATUSES.has(paymentStatus)) return { status: 'unverified' };
    const normalizedOrder = { ...order, amount_paid: paidValue, payment_status: paymentStatus };
    const paid = Math.round(paidValue * 100);
    const total = Math.round(order.total * 100);
    const statusContradictsBalance = paymentStatus === 'pagado' && paid < total - 1
        || paymentStatus === 'pendiente' && paid > 1
        || paymentStatus === 'parcial' && (paid <= 1 || paid >= total - 1);
    if (statusContradictsBalance) return { status: 'unverified', order: normalizedOrder };
    if (!Array.isArray(payments) || payments.length > 50) return { status: 'unverified', order: normalizedOrder };

    const proofUrl = Object.prototype.hasOwnProperty.call(order, 'payment_proof_url') ? order.payment_proof_url : null;
    if (proofUrl !== null && typeof proofUrl !== 'string') return { status: 'unverified', order: normalizedOrder };
    const proofPresent = typeof proofUrl === 'string' && proofUrl.length > 0;
    const proofMethod = Object.prototype.hasOwnProperty.call(order, 'payment_proof_method') ? order.payment_proof_method : null;
    const proofUploadedAt = Object.prototype.hasOwnProperty.call(order, 'payment_proof_uploaded_at') ? order.payment_proof_uploaded_at : null;
    if (proofPresent && (!PAYMENT_METHODS.has(proofMethod) || !validDate(proofUploadedAt))) return { status: 'unverified', order: normalizedOrder };
    if (!proofPresent && (proofMethod != null || proofUploadedAt != null)) return { status: 'unverified', order: normalizedOrder };
    if (paymentStatus === 'comprobante_subido' && !proofPresent) return { status: 'unverified', order: normalizedOrder };

    let completedAmount = 0;
    let completedCount = 0;
    const paymentIds = new Set();
    for (const payment of payments) {
        if (!payment || typeof payment !== 'object' || Array.isArray(payment)
            || typeof payment.id !== 'string' || payment.id.trim() === '' || paymentIds.has(payment.id)
            || payment.order_id !== orderId || !PAYMENT_STATUSES.has(payment.status)
            || !isAmount(payment.amount) || !PAYMENT_METHODS.has(payment.method)
            || !validDate(payment.created_at)) return { status: 'unverified', order: normalizedOrder };
        paymentIds.add(payment.id);
        if (payment.status === 'completed') {
            completedCount += 1;
            completedAmount += payment.amount;
        }
        if (['voided', 'refunded', 'voiding'].includes(payment.status)
            && (payment.void_reason != null && typeof payment.void_reason !== 'string'
                || payment.voided_at != null && !validDate(payment.voided_at))) return { status: 'unverified' };
    }

    const complete = payments.length < 50;
    const mismatch = complete && Math.abs(Math.round(completedAmount * 100) - paid) > 1;
    if (mismatch) return {
        status: 'unverified', order: normalizedOrder, payments, completedAmount, completedCount, proofPresent,
        proofMethod: proofPresent ? proofMethod : null, proofUploadedAt: proofPresent ? proofUploadedAt : null,
    };
    const unsubstantiatedConfirmation = paymentStatus === 'confirmado' && paid === 0 && !proofPresent;
    const empty = complete && payments.length === 0 && paid === 0 && !proofPresent && paymentStatus === 'pendiente';
    return {
        status: unsubstantiatedConfirmation ? 'unverified' : complete ? (empty ? 'empty' : 'complete') : 'incomplete',
        order: normalizedOrder,
        payments,
        completedAmount,
        completedCount,
        proofPresent,
        proofMethod: proofPresent ? proofMethod : null,
        proofUploadedAt: proofPresent ? proofUploadedAt : null,
    };
}

function dateLabel(value) {
    return new Date(value).toLocaleString('es-PE');
}

export default function AccountPaymentAudit({ order, scopeParams = EMPTY_SCOPE_PARAMS }) {
    const [open, setOpen] = useState(false);
    const [result, setResult] = useState(null);
    const requestSequence = useRef(0);
    const orderId = order?.id;

    useEffect(() => {
        const sequence = ++requestSequence.current;
        let active = true;
        if (!open || !orderId) {
            setResult(null);
            return () => { active = false; };
        }

        setResult({ orderId, status: 'loading' });
        const options = Object.keys(scopeParams || {}).length ? { params: scopeParams } : undefined;
        Promise.all([
            api.get(`/orders/${encodeURIComponent(orderId)}`, options),
            api.get(`/payments/by-order/${encodeURIComponent(orderId)}`, options),
        ]).then(([orderResponse, paymentResponse]) => {
            if (!active || sequence !== requestSequence.current) return;
            const audit = inspectAudit(orderId, orderResponse?.data, paymentResponse?.data);
            setResult({ orderId, ...audit });
        }).catch(() => {
            if (active && sequence === requestSequence.current) setResult({ orderId, status: 'error' });
        });

        return () => { active = false; };
    }, [open, orderId, scopeParams]);

    const current = result?.orderId === orderId ? result : (open ? { status: 'loading' } : null);

    return (
        <>
            <Button type="button" variant="outline" size="sm" className="mt-2 h-9"
                data-testid={`caja-audit-order-${order?.order_number ?? 'unknown'}`}
                onClick={() => setOpen(true)}>
                Revisar pagos
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
                    <DialogHeader>
                        <DialogTitle>Consulta de pagos — Pedido #{order?.order_number ?? '—'}</DialogTitle>
                        <p className="text-sm text-muted-foreground">Vista informativa. No determina si una cuenta puede cancelarse ni autoriza una acción financiera.</p>
                    </DialogHeader>
                    {!current || current.status === 'loading' ? (
                        <p role="status">Cargando historial…</p>
                    ) : current.status === 'error' ? (
                        <p role="alert">No se pudo verificar el historial. Comprueba los permisos o vuelve a intentarlo.</p>
                    ) : !current.order ? (
                        <p role="alert">No se pudo verificar la cuenta y su historial.</p>
                    ) : (
                        <div className="space-y-4">
                            {current.status === 'incomplete' && <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900">La consulta alcanzó el límite de 50 registros. El historial está incompleto y no permite confirmar el total.</p>}
                            {current.status === 'unverified' && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">Hay datos ausentes, inconsistentes o no reconocidos. El historial no se puede verificar.</p>}
                            {(current.status === 'complete' || current.status === 'empty') && <p role="status" className="text-sm">Los totales de la cuenta coinciden con los pagos completados consultados.</p>}
                            {current.order.payment_status === 'confirmado' && current.order.amount_paid === 0 && !current.proofPresent && <p role="alert">El pedido figura como confirmado, pero no hay pagos ni comprobante para verificar ese estado.</p>}
                            <section aria-label="Resumen de la cuenta" className="rounded-md border p-3">
                                <h3 className="mb-2 font-semibold">Resumen</h3>
                                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                                    <div><dt className="text-muted-foreground">Total de la cuenta</dt><dd>{fmtMoney(current.order.total)}</dd></div>
                                    <div><dt className="text-muted-foreground">Pagado en la cuenta</dt><dd>{fmtMoney(current.order.amount_paid)}</dd></div>
                                    <div><dt className="text-muted-foreground">Registros devueltos</dt><dd>{current.status === 'incomplete' ? '50 (límite alcanzado)' : current.payments?.length ?? 'No verificable'}</dd></div>
                                    <div><dt className="text-muted-foreground">Pagos completados</dt><dd>{current.completedCount ?? 'No verificable'}</dd></div>
                                    <div><dt className="text-muted-foreground">Subtotal completado de registros listados</dt><dd>{current.completedAmount == null ? 'No verificable' : fmtMoney(current.completedAmount)}</dd></div>
                                    <div><dt className="text-muted-foreground">Estado de pago de la cuenta</dt><dd>{ORDER_PAYMENT_LABELS[current.order.payment_status] || 'No reconocido'}</dd></div>
                                    <div><dt className="text-muted-foreground">Comprobante</dt><dd>{current.proofPresent ? 'Registrado' : current.status === 'unverified' ? 'No verificable' : 'No registrado'}</dd></div>
                                </dl>
                                {current.proofPresent && <p className="mt-2 text-sm">Método: {PAYMENT_LABELS[current.proofMethod] || current.proofMethod} · recibido {dateLabel(current.proofUploadedAt)}</p>}
                            </section>
                            {current.status === 'empty' ? <p>No hay pagos registrados ni comprobante disponible en esta consulta.</p> : Array.isArray(current.payments) ? (
                                <section aria-label="Registros de pago">
                                    <h3 className="mb-2 font-semibold">Registros ({current.status === 'incomplete' ? '50; historial truncado' : current.payments?.length ?? 0})</h3>
                                    {!current.payments?.length ? <p className="text-sm text-muted-foreground">No hay registros de pago.</p> : (
                                        <ol className="divide-y rounded-md border">
                                            {current.payments.map((payment) => (
                                                <li key={payment.id} className="space-y-1 p-3 text-sm">
                                                    <div className="flex flex-wrap justify-between gap-2">
                                                        <span>{PAYMENT_RECORD_STATUS_LABELS[payment.status]}</span>
                                                        <span>{fmtMoney(payment.amount)}</span>
                                                    </div>
                                                    <div className="text-muted-foreground">{PAYMENT_LABELS[payment.method] || payment.method} · {dateLabel(payment.created_at)}</div>
                                                    {payment.status !== 'completed' && <div className="text-muted-foreground">Resolución: {payment.void_kind === 'refund' || payment.status === 'refunded' ? 'Devolución' : payment.status === 'voiding' ? 'En curso' : 'Anulación'}{payment.void_reason ? ` · Motivo: ${payment.void_reason}` : ''}{payment.voided_at ? ` · ${dateLabel(payment.voided_at)}` : ''}</div>}
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </section>
                            ) : <p role="status">Los registros de pago no se pueden verificar.</p>}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
