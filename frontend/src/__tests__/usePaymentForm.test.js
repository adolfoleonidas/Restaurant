import { act } from 'react';
import usePaymentForm from '@/hooks/usePaymentForm';
import { renderHook } from '@/test-utils/renderHook';

let mockKeyCount = 0;
jest.mock('@/lib/cash', () => ({
    ...jest.requireActual('@/lib/cash'),
    newIdempotencyKey: () => { mockKeyCount += 1; return `key-${mockKeyCount}`; },
}));

const acct = {
    id: 'o1', subtotal: 100, delivery_fee: 0, discount: 0, amount_paid: 0, total: 100, updated_at: 'u1',
    items: [
        { id: 'a', product_name: 'Ceviche', quantity: 2, paid_qty: 0, unit_price: 30 },
        { id: 'b', product_name: 'Chicha', quantity: 8, paid_qty: 0, unit_price: 5 },
    ],
};

let mounted;
const mount = async (props = {}) => {
    mounted = await renderHook((p) => usePaymentForm(p), { acct, online: true, ...props });
    return mounted.result;
};

beforeEach(() => { mockKeyCount = 0; });
afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('usePaymentForm', () => {
    test('starts on cash for the whole account', async () => {
        const result = await mount();
        const f = result.current;
        expect(f.method).toBe('cash');
        expect(f.payMode).toBe('all');
        expect(f.people).toBe(2);
        expect(f.charge.chargeAmount).toBe(100);
        expect(f.backendMethod).toBe('efectivo');
        expect(f.canRegister).toBe(true);
        expect(f.splits).toEqual([{ method: 'cash', amount: '' }, { method: 'yape', amount: '' }]);
    });

    test('works while there is no account yet', async () => {
        const result = await mount({ acct: null });
        expect(result.current.charge.chargeAmount).toBe(0);
        expect(result.current.canRegister).toBe(false);
    });

    test('typed cash, discount and tip feed the derived numbers', async () => {
        const result = await mount();
        act(() => result.current.setReceived('120'));
        expect(result.current.cash.change).toBe(20);
        act(() => result.current.setDiscount('10'));
        expect(result.current.charge.chargeAmount).toBe(90);
        act(() => result.current.setTip('5'));
        expect(result.current.charge.total).toBe(95);
        act(() => result.current.setReceived('50'));
        expect(result.current.canRegister).toBe(false);
        expect(result.current.cash.cashError).toContain('Faltan');
    });

    test('tip chips set the tip from the base total and "Sin propina" clears it', async () => {
        const result = await mount();
        act(() => result.current.handleTipChip(10));
        expect(result.current.tip).toBe('10');
        expect(result.current.tipPct).toBe(10);
        act(() => result.current.handleTipChip(0));
        expect(result.current.tip).toBe('');
        expect(result.current.tipPct).toBe(0);
    });

    test('cash presets and the on-screen keypad', async () => {
        const result = await mount();
        act(() => result.current.handlePreset('exact'));
        expect(result.current.received).toBe('100.00');
        act(() => result.current.handlePreset(50));
        expect(result.current.received).toBe('50.00');

        act(() => result.current.setReceived(''));
        ['1', '2', '.', '5'].forEach((k) => act(() => result.current.handleKeypadPress(k)));
        expect(result.current.received).toBe('12.5');
        act(() => result.current.handleKeypadPress('.'));
        expect(result.current.received).toBe('12.5');
        act(() => result.current.handleKeypadPress('⌫'));
        expect(result.current.received).toBe('12.');
        act(() => result.current.setReceived(''));
        act(() => result.current.handleKeypadPress('.'));
        expect(result.current.received).toBe('0.');
        act(() => result.current.setReceived('123456'));
        act(() => result.current.handleKeypadPress('7'));
        expect(result.current.received).toBe('123456');
    });

    test('by items, only picked lines are charged', async () => {
        const result = await mount();
        act(() => result.current.setPayMode('items'));
        expect(result.current.charge.chargeAmount).toBe(0);
        expect(result.current.canRegister).toBe(false);
        act(() => result.current.setPicked({ a: 2 }));
        expect(result.current.charge.chargeAmount).toBe(60);
        expect(result.current.scopeCaption).toBe('1 de 2 ítems');
        expect(result.current.canRegister).toBe(true);
    });

    test('mixed payments: add, edit and remove lines', async () => {
        const result = await mount();
        act(() => result.current.setMethod('mixed'));
        expect(result.current.canAddSplit).toBe(true);
        act(() => result.current.updateSplit(0, { amount: '40' }));
        expect(result.current.md.rest).toBe(60);
        expect(result.current.canRegister).toBe(true);

        act(() => result.current.addSplit());
        expect(result.current.splits.map((s) => s.method)).toEqual(['cash', 'yape', 'plin']);
        // the previously automatic last line becomes a typed one with half the rest
        expect(result.current.splits[1].amount).toBe('30');

        act(() => result.current.updateSplit(2, { method: 'cash' }));
        expect(result.current.md.error).toBe('Elige un método distinto en cada línea.');
        expect(result.current.canRegister).toBe(false);

        act(() => result.current.removeSplit(2));
        expect(result.current.splits).toHaveLength(2);
        act(() => result.current.removeSplit(1));
        expect(result.current.splits).toHaveLength(2);
        expect(result.current.splitsTotal).toBe(70);
    });

    test('registering is blocked offline', async () => {
        const result = await mount({ online: false });
        expect(result.current.canRegister).toBe(false);
    });

    test('buildPayload carries the idempotency key and rotating it changes the next one', async () => {
        const result = await mount();
        act(() => result.current.resetForm(acct));
        expect(result.current.buildPayload()).toMatchObject({
            order_id: 'o1', method: 'efectivo', amount: 100, idempotency_key: 'key-1', received_amount: 100,
        });
        act(() => result.current.rotateIdempotencyKey());
        expect(result.current.buildPayload().idempotency_key).toBe('key-2');
    });

    test('resetForm clears every field and opens on the pending proof method', async () => {
        const result = await mount();
        act(() => {
            result.current.setMethod('card');
            result.current.setReceived('9');
            result.current.setDiscount('3');
            result.current.setDiscountReason('x');
            result.current.setTip('2');
            result.current.setPayMode('equal');
            result.current.setPeople(5);
            result.current.setPart(2);
            result.current.setPicked({ a: 1 });
            result.current.setCardRef('ref');
        });
        act(() => result.current.resetForm({ ...acct, payment_status: 'comprobante_subido', payment_proof_method: 'yape' }));
        const f = result.current;
        expect(f.method).toBe('yape');
        expect([f.received, f.discount, f.discountReason, f.tip, f.tipPct, f.payMode, f.people, f.part, f.cardRef])
            .toEqual(['', '', '', '', 0, 'all', 2, 0, '']);
        expect(f.picked).toEqual({});
        expect(f.splits).toEqual([{ method: 'cash', amount: '' }, { method: 'yape', amount: '' }]);
    });
});
