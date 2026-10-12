import { overlayPendingLines, plainDraftLine, resolveTap } from '@/lib/optimisticOrder';

const line = (id, productId, quantity, extra = {}) => ({
    id, product_id: productId, product_name: `P ${productId}`, quantity, unit_price: 10, subtotal: quantity * 10, status: 'borrador', notes: null, ...extra,
});
const order = (items, extra = {}) => ({ id: 'o1', status: 'nuevo', total: items.reduce((s, i) => s + i.subtotal, 0), items, ...extra });
const product = { id: 'p1', name: 'Sopa', price: 10 };
const placeholder = { id: null, status: 'nuevo', items: [], total: 0 };

describe('overlayPendingLines', () => {
    test('returns the same order when nothing is pending', () => {
        const base = order([line('a', 'p1', 2)]);
        expect(overlayPendingLines(base, {}, placeholder)).toBe(base);
    });

    test('shows the pending quantity of an existing line, with its subtotal and the order total', () => {
        const base = order([line('a', 'p1', 2), line('b', 'p2', 1)]);
        const out = overlayPendingLines(base, { 'line:a': { kind: 'line', lineId: 'a', quantity: 5 } }, placeholder);
        expect(out.items[0]).toMatchObject({ id: 'a', quantity: 5, subtotal: 50, __key: 'line:a' });
        expect(out.items[1]).toBe(base.items[1]);
        expect(out.total).toBe(60);
    });

    test('a pending quantity of zero hides the line', () => {
        const base = order([line('a', 'p1', 1)]);
        const out = overlayPendingLines(base, { 'line:a': { kind: 'line', lineId: 'a', quantity: 0 } }, placeholder);
        expect(out.items).toEqual([]);
        expect(out.total).toBe(0);
    });

    test('a product that is not in the order yet shows as a virtual draft line', () => {
        const base = order([line('a', 'p2', 1)]);
        const out = overlayPendingLines(base, { 'new:p1': { kind: 'new', productId: 'p1', product, quantity: 2 } }, placeholder);
        expect(out.items).toHaveLength(2);
        expect(out.items[1]).toMatchObject({
            id: 'pending:new:p1', __virtual: true, __key: 'new:p1', product_id: 'p1', product_name: 'Sopa', quantity: 2, subtotal: 20, status: 'borrador',
        });
        expect(out.total).toBe(30);
    });

    test('without an order yet, the placeholder carries the virtual lines', () => {
        const out = overlayPendingLines(null, { 'new:p1': { kind: 'new', productId: 'p1', product, quantity: 1 } }, placeholder);
        expect(out.id).toBeNull();
        expect(out.items).toHaveLength(1);
        expect(out.total).toBe(10);
        expect(overlayPendingLines(null, {}, placeholder)).toBeNull();
    });

    test('a created line that is bound to its entry is not shown twice', () => {
        const base = order([line('a', 'p1', 1)]);
        const out = overlayPendingLines(base, { 'new:p1': { kind: 'new', productId: 'p1', product, lineId: 'a', quantity: 3 } }, placeholder);
        expect(out.items).toHaveLength(1);
        expect(out.items[0]).toMatchObject({ id: 'a', quantity: 3, __key: 'new:p1' });
    });

    test('an entry whose line is gone from the order is ignored', () => {
        const base = order([line('a', 'p1', 1)]);
        const out = overlayPendingLines(base, { 'line:z': { kind: 'line', lineId: 'z', quantity: 4 } }, placeholder);
        expect(out.items).toEqual(base.items);
    });

    test('does not mutate the order it receives', () => {
        const base = order([line('a', 'p1', 2)]);
        const copy = JSON.parse(JSON.stringify(base));
        overlayPendingLines(base, { 'line:a': { kind: 'line', lineId: 'a', quantity: 9 } }, placeholder);
        expect(base).toEqual(copy);
    });
});

describe('plainDraftLine', () => {
    test('finds the first draft line of the product without notes', () => {
        const base = order([
            line('s', 'p1', 1, { status: 'pendiente' }),
            line('n', 'p1', 1, { notes: 'sin sal' }),
            line('d', 'p1', 1),
        ]);
        expect(plainDraftLine(base, 'p1').id).toBe('d');
        expect(plainDraftLine(base, 'p9')).toBeNull();
    });
});

describe('resolveTap', () => {
    test('+ goes to the first unannotated draft line of the product', () => {
        const base = order([line('a', 'p1', 2)]);
        const hit = resolveTap(base, product, 1);
        expect(hit.key).toBe('line:a');
        expect(hit.patch).toEqual({ kind: 'line', orderId: 'o1', lineId: 'a', quantity: 3 });
    });

    test('+ opens a new line when the product only has sent or annotated lines', () => {
        const base = order([line('s', 'p1', 1, { status: 'pendiente' }), line('n', 'p1', 1, { notes: 'sin sal' })], { status: 'en_preparacion' });
        const hit = resolveTap(base, product, 1);
        expect(hit.key).toBe('new:p1');
        expect(hit.patch).toMatchObject({ kind: 'new', productId: 'p1', product, orderId: 'o1', quantity: 1 });
    });

    test('+ on a virtual line keeps the same key and only changes the quantity', () => {
        const virtual = overlayPendingLines(
            order([]),
            { 'new:p1': { kind: 'new', productId: 'p1', product, quantity: 1 } },
            placeholder
        );
        const hit = resolveTap(virtual, product, 1);
        expect(hit.key).toBe('new:p1');
        expect(hit.patch).toEqual({ quantity: 2 });
    });

    test('- takes one unit from the last draft line and never goes below zero', () => {
        const base = order([line('a', 'p1', 1), line('b', 'p1', 2, { notes: 'sin sal' })]);
        const hit = resolveTap(base, product, -1);
        expect(hit.key).toBe('line:b');
        expect(hit.patch.quantity).toBe(1);
        expect(resolveTap(order([line('a', 'p1', 1)]), product, -1).patch.quantity).toBe(0);
    });

    test('- does nothing when the product has no draft line (sent lines are not editable here)', () => {
        const base = order([line('s', 'p1', 2, { status: 'pendiente' })], { status: 'en_preparacion' });
        expect(resolveTap(base, product, -1)).toBeNull();
    });

    test('works on the placeholder when the order does not exist yet', () => {
        const hit = resolveTap(placeholder, product, 1);
        expect(hit.key).toBe('new:p1');
        expect(hit.patch).toMatchObject({ kind: 'new', orderId: null, quantity: 1 });
    });
});
