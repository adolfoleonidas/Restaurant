import {
    PAYMENT_METHODS,
    METHOD_MAP,
    METHOD_REV,
    DIGITAL_METHODS,
    WALLET_METHOD_IDS,
    toBackendMethod,
    isWalletMethod,
} from '@/lib/paymentMethods';
import {
    quickCashAmounts,
    computeCharge,
    computeCash,
    mixedPaymentData,
    splitsTotalOf,
    paymentScopeCaption,
    canRegisterPayment,
    buildPaymentPayload,
    verifyCopy,
    verifyWarning,
    verifyContext,
    registerLabel,
    footerNote,
    pendingProofMethod,
} from '@/lib/paymentForm';

describe('paymentMethods', () => {
    test('the six methods keep their prototype id, label and backend id', () => {
        expect(PAYMENT_METHODS.map((m) => [m.id, m.name, m.backend])).toEqual([
            ['cash', 'Efectivo', 'efectivo'],
            ['yape', 'Yape', 'yape'],
            ['plin', 'Plin', 'plin'],
            ['card', 'Tarjeta', 'tarjeta'],
            ['transfer', 'Transferencia', 'transferencia'],
            ['mixed', 'Mixto', 'mixto'],
        ]);
        expect(METHOD_MAP).toEqual({
            cash: 'efectivo', yape: 'yape', plin: 'plin', card: 'tarjeta', transfer: 'transferencia', mixed: 'mixto',
        });
        expect(METHOD_REV.efectivo).toBe('cash');
        expect(METHOD_REV.mixto).toBe('mixed');
    });

    test('digital methods are the ones that do not go to the drawer', () => {
        expect(DIGITAL_METHODS).toEqual(['yape', 'plin', 'tarjeta', 'transferencia']);
        expect(WALLET_METHOD_IDS).toEqual(['yape', 'plin']);
        expect(isWalletMethod('yape')).toBe(true);
        expect(isWalletMethod('plin')).toBe(true);
        expect(isWalletMethod('card')).toBe(false);
    });

    test('toBackendMethod falls back to cash', () => {
        expect(toBackendMethod('transfer')).toBe('transferencia');
        expect(toBackendMethod('unknown')).toBe('efectivo');
    });
});

const acct = {
    id: 'o1', subtotal: 100, delivery_fee: 5, discount: 0, amount_paid: 20, total: 105, updated_at: 'u1',
    items: [
        { id: 'a', product_name: 'Ceviche', quantity: 2, paid_qty: 0, unit_price: 30 },
        { id: 'b', product_name: 'Lomo', quantity: 1, paid_qty: 1, unit_price: 40 },
        { id: 'c', product_name: 'Chicha', quantity: 3, paid_qty: 1, unit_price: 5 },
    ],
};

const base = {
    acct, discount: '', tip: '', payMode: 'all', people: 2, picked: {},
};

describe('computeCharge', () => {
    test('whole account: subtotal plus fee minus the account discount, minus what is paid', () => {
        const c = computeCharge(base);
        expect(c.baseTotal).toBe(105);
        expect(c.total).toBe(105);
        expect(c.paid).toBe(20);
        expect(c.remaining).toBe(85);
        expect(c.chargeAmount).toBe(85);
        expect(c.tipInvalid).toBe(false);
    });

    test('a typed discount replaces the account one and a tip is added on top', () => {
        const c = computeCharge({ ...base, discount: '10', tip: '5.5' });
        expect(c.d).toBe(10);
        expect(c.baseTotal).toBe(95);
        expect(c.tipVal).toBe(5.5);
        expect(c.total).toBe(100.5);
        expect(c.remaining).toBe(80.5);
        expect(computeCharge({ ...base, discount: '' , acct: { ...acct, discount: 7 } }).d).toBe(7);
    });

    test('an invalid tip is flagged and counts as zero', () => {
        const c = computeCharge({ ...base, tip: '1.234' });
        expect(c.tipInvalid).toBe(true);
        expect(c.tipVal).toBe(0);
    });

    test('by items only the unpaid units of the picked lines are charged', () => {
        const c = computeCharge({ ...base, payMode: 'items', picked: { a: 2, c: 1, b: 1 } });
        expect(c.unpaidItems.map((i) => [i.id, i.unpaid])).toEqual([['a', 2], ['c', 2]]);
        expect(c.pickedLines).toEqual([
            { item_id: 'a', quantity: 2, name: 'Ceviche', unit_price: 30 },
            { item_id: 'c', quantity: 1, name: 'Chicha', unit_price: 5 },
        ]);
        expect(c.itemsAmount).toBe(65);
        expect(c.chargeAmount).toBe(65);
    });

    test('equal parts round the share down to cents and never split below two', () => {
        expect(computeCharge({ ...base, payMode: 'equal', people: 3 }).chargeAmount).toBe(28.33);
        expect(computeCharge({ ...base, payMode: 'equal', people: 1 }).partsN).toBe(2);
    });

    test('without an account everything is zero', () => {
        const c = computeCharge({ ...base, acct: {} });
        expect(c.total).toBe(0);
        expect(c.chargeAmount).toBe(0);
        expect(c.unpaidItems).toEqual([]);
    });
});

describe('cash and mixed payments', () => {
    test('cash change and the shortfall message', () => {
        expect(computeCash({ method: 'cash', received: '100', chargeAmount: 85 })).toEqual({ r: 100, change: 15, cashError: '' });
        expect(computeCash({ method: 'cash', received: '50', chargeAmount: 85 })).toEqual({
            r: 50, change: 0, cashError: 'Faltan S/ 35.00 para completar este cobro.',
        });
        expect(computeCash({ method: 'cash', received: 'abc', chargeAmount: 85 }).cashError).toBe('Ingresa un importe válido.');
        expect(computeCash({ method: 'cash', received: '', chargeAmount: 85 })).toEqual({ r: null, change: 0, cashError: '' });
        expect(computeCash({ method: 'card', received: '100', chargeAmount: 85 }).change).toBe(0);
    });

    test('mixed data: the last line takes the rest', () => {
        const md = mixedPaymentData({
            splits: [{ method: 'cash', amount: '30' }, { method: 'yape', amount: '' }], chargeAmount: 85,
        });
        expect(md.lines).toEqual([{ method: 'efectivo', cents: 30 }, { method: 'yape', cents: 55 }]);
        expect(md.rest).toBe(55);
        expect(md.valid).toBe(true);
        expect(md.error).toBe('');
    });

    test('mixed data rejects repeated methods, empty amounts and totals that already cover the charge', () => {
        const repeated = mixedPaymentData({
            splits: [{ method: 'cash', amount: '30' }, { method: 'cash', amount: '' }], chargeAmount: 85,
        });
        expect(repeated.valid).toBe(false);
        expect(repeated.error).toBe('Elige un método distinto en cada línea.');

        const bad = mixedPaymentData({
            splits: [{ method: 'cash', amount: '0' }, { method: 'yape', amount: '' }], chargeAmount: 85,
        });
        expect(bad.valid).toBe(false);
        expect(bad.error).toBe('Cada importe debe ser mayor que cero (máximo 2 decimales).');

        const covered = mixedPaymentData({
            splits: [{ method: 'cash', amount: '90' }, { method: 'yape', amount: '' }], chargeAmount: 85,
        });
        expect(covered.valid).toBe(false);
        expect(covered.error).toBe('Los importes ya cubren el total. El último método necesita un saldo.');

        const empty = mixedPaymentData({
            splits: [{ method: 'cash', amount: '' }, { method: 'yape', amount: '' }], chargeAmount: 85,
        });
        expect(empty.valid).toBe(false);
        expect(empty.error).toBe('');
    });

    test('splitsTotalOf adds the typed amounts', () => {
        expect(splitsTotalOf([{ amount: '10' }, { amount: '2.5' }, { amount: 'x' }])).toBe(12.5);
    });
});

describe('registering', () => {
    const md = { valid: true };

    test('canRegisterPayment follows the method rules', () => {
        const ok = {
            online: true, tipInvalid: false, chargeAmount: 85, method: 'cash', received: '', r: null, md,
        };
        expect(canRegisterPayment(ok)).toBe(true);
        expect(canRegisterPayment({ ...ok, online: false })).toBe(false);
        expect(canRegisterPayment({ ...ok, tipInvalid: true })).toBe(false);
        expect(canRegisterPayment({ ...ok, chargeAmount: 0 })).toBe(false);
        expect(canRegisterPayment({ ...ok, received: '50', r: 50 })).toBe(false);
        expect(canRegisterPayment({ ...ok, received: '90', r: 90 })).toBe(true);
        expect(canRegisterPayment({ ...ok, method: 'mixed', md: { valid: false } })).toBe(false);
        expect(canRegisterPayment({ ...ok, method: 'yape' })).toBe(true);
    });

    test('payload carries the effective discount, tip, idempotency and optimistic locks', () => {
        const payload = buildPaymentPayload({
            acct, backendMethod: 'efectivo', method: 'cash', chargeAmount: 85, d: 0, discountReason: '  ',
            tipVal: 0, idempotencyKey: 'k1', r: null, md, payMode: 'all', pickedLines: [],
        });
        expect(payload).toEqual({
            order_id: 'o1',
            method: 'efectivo',
            amount: 85,
            discount: 0,
            discount_reason: undefined,
            tip: 0,
            idempotency_key: 'k1',
            expected_updated_at: 'u1',
            expected_total: 105,
            received_amount: 85,
        });
    });

    test('mixed payments send their positive splits and item payments their lines', () => {
        const mixed = buildPaymentPayload({
            acct, backendMethod: 'mixto', method: 'mixed', chargeAmount: 85, d: 10, discountReason: ' cortesía ',
            tipVal: 2, idempotencyKey: 'k2', r: null,
            md: { lines: [{ method: 'efectivo', cents: 30 }, { method: 'yape', cents: 55 }, { method: 'plin', cents: 0 }] },
            payMode: 'all', pickedLines: [],
        });
        expect(mixed.splits).toEqual([{ method: 'efectivo', amount: 30 }, { method: 'yape', amount: 55 }]);
        expect(mixed.discount_reason).toBe('cortesía');
        expect(mixed).not.toHaveProperty('received_amount');

        const items = buildPaymentPayload({
            acct, backendMethod: 'yape', method: 'yape', chargeAmount: 65, d: 0, discountReason: '',
            tipVal: 0, idempotencyKey: 'k3', r: null, md, payMode: 'items',
            pickedLines: [{ item_id: 'a', quantity: 2, name: 'Ceviche', unit_price: 30 }],
        });
        expect(items.lines).toEqual([{ item_id: 'a', quantity: 2 }]);
    });

    test('cash payload sends the received amount', () => {
        const payload = buildPaymentPayload({
            acct, backendMethod: 'efectivo', method: 'cash', chargeAmount: 85, d: 0, discountReason: '',
            tipVal: 0, idempotencyKey: 'k', r: 100, md, payMode: 'all', pickedLines: [],
        });
        expect(payload.received_amount).toBe(100);
    });
});

describe('copy', () => {
    test('verify dialog copy by method', () => {
        expect(verifyCopy('cash')).toBe('Recibí el efectivo y comprobé el vuelto.');
        expect(verifyCopy('card')).toBe('Comprobé que el POS aprobó este cobro.');
        expect(verifyCopy('mixed')).toBe('Verifiqué todos los pagos y recibí el efectivo, si corresponde.');
        expect(verifyCopy('yape')).toBe('Verifiqué el ingreso en la cuenta receptora.');
        expect(verifyWarning('cash')).toBe('El importe registrado corresponde al cobro, no al efectivo entregado por el cliente.');
        expect(verifyWarning('mixed')).toBe('Todos los componentes se registrarán juntos.');
        expect(verifyWarning('plin')).toBe('Confirmación manual. Adjuntar una imagen no verifica automáticamente el pago.');
    });

    test('verify context', () => {
        expect(verifyContext({ method: 'cash', r: 100, change: 15, md: {} })).toBe('Recibido: S/ 100.00 · Vuelto: S/ 15.00');
        expect(verifyContext({ method: 'cash', r: null, change: 0, md: {} })).toBe('');
        expect(verifyContext({
            method: 'mixed', r: null, change: 0, md: { lines: [{ method: 'efectivo', cents: 30 }, { method: 'yape', cents: 55 }] },
        })).toBe('Efectivo: S/ 30.00 · Yape: S/ 55.00');
        expect(verifyContext({ method: 'card', r: null, change: 0, md: {} })).toBe('');
    });

    test('register label', () => {
        expect(registerLabel({ result: {}, method: 'cash', chargeAmount: 85, isMobile: false })).toBe('Finalizar');
        expect(registerLabel({ result: null, method: 'cash', chargeAmount: 85, isMobile: false })).toBe('Registrar efectivo · S/ 85.00');
        expect(registerLabel({ result: null, method: 'yape', chargeAmount: 85, isMobile: false })).toBe('Registrar pago verificado · S/ 85.00');
        expect(registerLabel({ result: null, method: 'yape', chargeAmount: 85, isMobile: true })).toBe('Registrar pago · S/ 85.00');
        expect(registerLabel({ result: null, method: 'mixed', chargeAmount: 85, isMobile: true })).toBe('Registrar pago');
    });

    test('footer note explains why registering is blocked', () => {
        const ok = {
            online: true, result: null, tipInvalid: false, canRegister: true, method: 'cash', r: null, chargeAmount: 85,
        };
        expect(footerNote(ok)).toBe('');
        expect(footerNote({ ...ok, online: false })).toBe('Sin conexión: reconecta para registrar');
        expect(footerNote({ ...ok, result: {} })).toBe('');
        expect(footerNote({ ...ok, tipInvalid: true })).toBe('Corrige la propina para continuar');
        expect(footerNote({ ...ok, canRegister: false })).toBe('Monto exacto · escribe el efectivo recibido si te dan un billete mayor');
        expect(footerNote({ ...ok, canRegister: false, r: 50 })).toBe('El efectivo recibido no cubre el total');
        expect(footerNote({ ...ok, canRegister: false, method: 'mixed' })).toBe('Completa los montos del pago mixto');
        expect(footerNote({ ...ok, canRegister: false, method: 'yape', chargeAmount: 0 })).toBe('Selecciona al menos un ítem');
    });

    test('scope caption', () => {
        expect(paymentScopeCaption({ payMode: 'all', unpaidItems: [], pickedLines: [], part: 0, people: 2 })).toBe('');
        expect(paymentScopeCaption({ payMode: 'items', unpaidItems: [{}, {}], pickedLines: [{}], part: 0, people: 2 })).toBe('1 de 2 ítems');
        expect(paymentScopeCaption({ payMode: 'items', unpaidItems: [], pickedLines: [], part: 0, people: 2 })).toBe('Selecciona al menos un ítem');
        expect(paymentScopeCaption({ payMode: 'equal', unpaidItems: [], pickedLines: [], part: 1, people: 3 })).toBe('Parte 2 de 3');
    });

    test('a pending wallet proof preselects its method', () => {
        expect(pendingProofMethod({ payment_status: 'comprobante_subido', payment_proof_method: 'plin' })).toBe('plin');
        expect(pendingProofMethod({ payment_status: 'comprobante_subido', payment_proof_method: 'transferencia' })).toBe('cash');
        expect(pendingProofMethod({ payment_status: 'pendiente', payment_proof_method: 'yape' })).toBe('cash');
        expect(pendingProofMethod(null)).toBe('cash');
    });
});

describe('quickCashAmounts', () => {
    test('the exact amount and round-ups to 10, 50, 100 and 200, never below the charge, at most four', () => {
        expect(quickCashAmounts(38)).toEqual([38, 40, 50, 100]);
        expect(quickCashAmounts(12.5)).toEqual([12.5, 20, 50, 100]);
        expect(quickCashAmounts(38.33)).toEqual([38.33, 40, 50, 100]);
    });

    test('repeated values collapse', () => {
        expect(quickCashAmounts(100)).toEqual([100, 200]);
        expect(quickCashAmounts(50)).toEqual([50, 100, 200]);
        expect(quickCashAmounts(250)).toEqual([250]);
    });

    test('a zero charge still offers the bills', () => {
        expect(quickCashAmounts(0)).toEqual([0, 100, 200]);
    });
});
