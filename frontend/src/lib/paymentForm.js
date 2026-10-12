/**
 * Pure rules of the charge form: totals, change, mixed payments, the request
 * payload and the copy that depends on them. No React and no I/O, so the dialog
 * and its tests read the same numbers.
 */
import { fmtMoney, PAYMENT_LABELS, countOf } from '@/lib/format';
import { equalShare, parseAmount, round2 } from '@/lib/cash';
import { METHOD_MAP, METHOD_REV } from '@/lib/paymentMethods';

/** Totals of the account being charged, in the selected scope (all, items, equal parts). */
export function computeCharge({
    acct, discount, tip, payMode, people, picked,
}) {
    const account = acct || {};
    const subtotal = account.subtotal || 0;
    const fee = Number(account.delivery_fee || 0);
    const d = Number(discount || account.discount || 0);
    const tipInvalid = tip.trim() !== '' && parseAmount(tip) === null;
    const tipVal = parseAmount(tip, true) || 0;
    const baseTotal = round2(Math.max(0, subtotal + fee - d));
    const total = round2(baseTotal + tipVal);
    const paid = Number(account.amount_paid || 0);
    const remaining = Math.max(0, round2(total - paid));

    const unpaidItems = (account.items || []).map((it) => ({
        ...it,
        unpaid: Math.max(0, (it.quantity || 0) - (it.paid_qty || 0)),
    })).filter((it) => it.unpaid > 0);

    const pickedLines = unpaidItems
        .map((it) => ({
            item_id: it.id, quantity: Number(picked[it.id] || 0), name: it.product_name, unit_price: it.unit_price,
        }))
        .filter((l) => l.quantity > 0);
    const itemsAmount = round2(pickedLines.reduce((s, l) => s + l.quantity * (l.unit_price || 0), 0));

    const partsN = Math.max(2, people);
    const chargeAmount = payMode === 'items'
        ? itemsAmount
        : payMode === 'equal'
            ? equalShare(remaining, partsN)
            : remaining;

    return {
        subtotal,
        fee,
        d,
        tipInvalid,
        tipVal,
        baseTotal,
        total,
        paid,
        remaining,
        unpaidItems,
        pickedLines,
        itemsAmount,
        partsN,
        chargeAmount,
    };
}

/** Cash received, the change owed and the inline error for the cash field. */
export function computeCash({ method, received, chargeAmount }) {
    const r = parseAmount(received);
    const change = method === 'cash' ? Math.max(0, (r || 0) - chargeAmount) : 0;
    const cashError = received.trim() !== '' && r === null
        ? 'Ingresa un importe válido.'
        : r !== null && chargeAmount > 0 && r < chargeAmount
            ? `Faltan ${fmtMoney(round2(chargeAmount - r))} para completar este cobro.`
            : '';
    return { r, change, cashError };
}

export function splitsTotalOf(splits) {
    return splits.reduce((s, x) => s + (parseAmount(x.amount, true) || 0), 0);
}

/** Lines of a mixed payment: every line but the last is typed, the last takes the rest. */
export function mixedPaymentData({ splits, chargeAmount }) {
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
    const usedMethods = ls.map((l) => l.method);
    if (new Set(usedMethods).size !== n) { ok = false; error = 'Elige un método distinto en cada línea.'; }
    if (rest <= 0) { ok = false; if (!error && ls.slice(0, -1).every((l) => l.amount)) error = 'Los importes ya cubren el total. El último método necesita un saldo.'; }
    return {
        lines, sum, rest, due, valid: ok && due > 0, error,
    };
}

/** "1 de 3 ítems": how many of the open lines are picked, with the noun in agreement. */
export function unpaidItemsLabel(picked, unpaid) {
    return `${picked} de ${countOf(unpaid, 'ítem', 'ítems')}`;
}

export function paymentScopeCaption({
    payMode, unpaidItems, pickedLines, part, people,
}) {
    if (payMode === 'items') {
        return unpaidItems.length ? unpaidItemsLabel(pickedLines.length, unpaidItems.length) : 'Selecciona al menos un ítem';
    }
    if (payMode === 'equal') return `Parte ${part + 1} de ${people}`;
    return '';
}

export function canRegisterPayment({
    online, tipInvalid, chargeAmount, method, received, r, md,
}) {
    if (!online) return false;
    if (tipInvalid) return false;
    if (chargeAmount <= 0) return false;
    // Cash with an empty field means "exact": the payload already defaults
    // received_amount to the charge, so the cashier is never stuck.
    if (method === 'cash') return !received.trim() || (r !== null && r >= chargeAmount);
    if (method === 'mixed') return md.valid;
    return true;
}

export function buildPaymentPayload({
    acct, backendMethod, method, chargeAmount, d, discountReason, tipVal, idempotencyKey, r, md, payMode, pickedLines,
}) {
    const payload = {
        order_id: acct.id,
        method: backendMethod,
        amount: chargeAmount,
        // Send the effective discount (the account's unless the cashier
        // changed it): sending 0 used to drop a discount on the account.
        discount: d,
        discount_reason: discountReason.trim() ? discountReason.trim() : undefined,
        tip: tipVal,
        idempotency_key: idempotencyKey,
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
    return payload;
}

// ---- copy ------------------------------------------------------------------

export function verifyCopy(method) {
    if (method === 'cash') return 'Recibí el efectivo y comprobé el vuelto.';
    if (method === 'card') return 'Comprobé que el POS aprobó este cobro.';
    if (method === 'mixed') return 'Verifiqué todos los pagos y recibí el efectivo, si corresponde.';
    return 'Verifiqué el ingreso en la cuenta receptora.';
}

export function verifyWarning(method) {
    if (method === 'cash') return 'El importe registrado corresponde al cobro, no al efectivo entregado por el cliente.';
    if (method === 'mixed') return 'Todos los componentes se registrarán juntos.';
    return 'Confirmación manual. Adjuntar una imagen no verifica automáticamente el pago.';
}

export function verifyContext({
    method, r, change, md,
}) {
    if (method === 'cash' && r !== null) return `Recibido: ${fmtMoney(r)} · Vuelto: ${fmtMoney(change)}`;
    if (method === 'mixed') return md.lines.map((l) => `${PAYMENT_LABELS[l.method] || l.method}: ${fmtMoney(Math.max(0, l.cents))}`).join(' · ');
    return '';
}

export function registerLabel({
    result, method, chargeAmount, isMobile,
}) {
    if (result) return 'Finalizar';
    const amt = method !== 'mixed' && chargeAmount > 0 ? ` · ${fmtMoney(chargeAmount)}` : '';
    if (method === 'cash') return `Registrar efectivo${amt}`;
    return (isMobile ? 'Registrar pago' : 'Registrar pago verificado') + amt;
}

export function footerNote({
    online, result, tipInvalid, canRegister, method, r, chargeAmount,
}) {
    if (!online) return 'Sin conexión: reconecta para registrar';
    if (result) return '';
    if (tipInvalid) return 'Corrige la propina para continuar';
    if (!canRegister) {
        if (method === 'cash' && !r) return 'Monto exacto · escribe el efectivo recibido si te dan un billete mayor';
        if (method === 'cash' && r < chargeAmount) return 'El efectivo recibido no cubre el total';
        if (method === 'mixed') return 'Completa los montos del pago mixto';
        if (chargeAmount <= 0) return 'Selecciona al menos un ítem';
    }
    return '';
}

/** Method the dialog opens on: a wallet proof already sent for this account keeps its method. */
export function pendingProofMethod(order) {
    return order?.payment_status === 'comprobante_subido'
        && ['yape', 'plin'].includes(order.payment_proof_method)
        ? (METHOD_REV[order.payment_proof_method] || 'cash')
        : 'cash';
}
