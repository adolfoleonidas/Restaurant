import { useRef, useState } from 'react';
import { newIdempotencyKey, round2 } from '@/lib/cash';
import { PAYMENT_METHODS, toBackendMethod } from '@/lib/paymentMethods';
import {
    buildPaymentPayload,
    canRegisterPayment,
    computeCash,
    computeCharge,
    mixedPaymentData,
    paymentScopeCaption,
    pendingProofMethod,
    quickCashAmounts,
    splitsTotalOf,
} from '@/lib/paymentForm';

const INITIAL_SPLITS = () => [{ method: 'cash', amount: '' }, { method: 'yape', amount: '' }];
const MAX_SPLITS = 5;

/**
 * State and derived numbers of the charge form: method, cash received, discount,
 * tip, split by items or equal parts, and mixed payments. The pure rules live in
 * `lib/paymentForm`; this hook only owns the state around them.
 */
export default function usePaymentForm({ acct, online }) {
    const [method, setMethod] = useState('cash');
    const [received, setReceived] = useState('');
    const [discount, setDiscount] = useState('');
    const [discountReason, setDiscountReason] = useState('');
    const [tip, setTip] = useState('');
    const [tipPct, setTipPct] = useState(0);
    const [splits, setSplits] = useState(INITIAL_SPLITS);
    const [payMode, setPayMode] = useState('all');
    const [people, setPeople] = useState(2);
    const [part, setPart] = useState(0);
    const [picked, setPicked] = useState({});
    const [cardRef, setCardRef] = useState('');
    const idempotencyRef = useRef(null);

    const charge = computeCharge({
        acct, discount, tip, payMode, people, picked,
    });
    const { chargeAmount, baseTotal } = charge;
    const backendMethod = toBackendMethod(method);
    const cash = computeCash({ method, received, chargeAmount });
    const quickCash = quickCashAmounts(chargeAmount);
    const splitsTotal = splitsTotalOf(splits);
    const md = mixedPaymentData({ splits, chargeAmount });
    const scopeCaption = paymentScopeCaption({
        payMode,
        unpaidItems: charge.unpaidItems,
        pickedLines: charge.pickedLines,
        part,
        people,
    });
    const canRegister = canRegisterPayment({
        online, tipInvalid: charge.tipInvalid, chargeAmount, method, received, r: cash.r, md,
    });

    const handleTipChip = (pct) => {
        setTipPct(pct);
        if (pct === 0) { setTip(''); }
        else { setTip(String(round2(baseTotal * pct / 100))); }
    };

    // Preset cash
    const handlePreset = (val) => {
        if (val === 'exact') { setReceived(chargeAmount.toFixed(2)); return; }
        setReceived(Number(val).toFixed(2));
    };

    // On-screen keypad for coarse pointers (phones/tablets without keyboard)
    const handleKeypadPress = (key) => {
        let v = received;
        if (key === '⌫') v = v.slice(0, -1);
        else if (key === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
        else v += key;
        if (/^\d{0,6}(\.\d{0,2})?$/.test(v)) setReceived(v);
    };

    const updateSplit = (idx, patch) => {
        const c = [...splits];
        c[idx] = { ...c[idx], ...patch };
        setSplits(c);
    };

    const removeSplit = (idx) => {
        if (splits.length > 2) setSplits(splits.filter((_, i) => i !== idx));
    };

    const canAddSplit = splits.length < MAX_SPLITS;
    const addSplit = () => {
        const used = splits.map((l) => l.method);
        const free = PAYMENT_METHODS.find((m) => m.id !== 'mixed' && !used.includes(m.id));
        if (!free) return;
        // The current auto last line becomes a typed line: prefill a sensible half of the remainder.
        const prefill = String(Math.max(1, Math.floor(Math.max(0, md.rest) / 2)));
        const next = splits.map((l, i) => (i === splits.length - 1 ? { ...l, amount: l.amount || prefill } : l));
        setSplits([...next, { method: free.id, amount: '' }]);
    };

    const rotateIdempotencyKey = () => { idempotencyRef.current = newIdempotencyKey(); };

    /** Back to a clean form for `order` (called when the dialog opens). */
    const resetForm = (order) => {
        setMethod(pendingProofMethod(order));
        setReceived(''); setDiscount(''); setDiscountReason(''); setTip('');
        setTipPct(0);
        setSplits(INITIAL_SPLITS());
        setPayMode('all'); setPeople(2); setPart(0); setPicked({});
        setCardRef('');
        rotateIdempotencyKey();
    };

    /** After a partial payment: charge the rest of the account from scratch. */
    const resetForRest = () => {
        setPayMode('all'); setPicked({});
        setReceived('');
        rotateIdempotencyKey();
    };

    const buildPayload = () => buildPaymentPayload({
        acct,
        backendMethod,
        method,
        chargeAmount,
        d: charge.d,
        discountReason,
        tipVal: charge.tipVal,
        idempotencyKey: idempotencyRef.current,
        r: cash.r,
        md,
        payMode,
        pickedLines: charge.pickedLines,
    });

    return {
        method, setMethod,
        received, setReceived,
        discount, setDiscount,
        discountReason, setDiscountReason,
        tip, setTip,
        tipPct, setTipPct,
        splits, setSplits,
        payMode, setPayMode,
        people, setPeople,
        part, setPart,
        picked, setPicked,
        cardRef, setCardRef,
        charge,
        cash,
        quickCash,
        md,
        splitsTotal,
        scopeCaption,
        backendMethod,
        canRegister,
        handleTipChip,
        handlePreset,
        handleKeypadPress,
        updateSplit,
        removeSplit,
        addSplit,
        canAddSplit,
        rotateIdempotencyKey,
        resetForm,
        resetForRest,
        buildPayload,
    };
}
