/**
 * CP-01: a tap must re-render only the card that was tapped.
 *
 * Each card renders its price through `fmtMoney` exactly once per render, so the
 * calls made with a card's (unique) price count that card's renders without
 * adding any test hook to production code.
 */
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import OrderComposer from '@/components/OrderComposer';
import { fmtMoney } from '@/lib/format';

jest.mock('@/lib/format', () => {
    const actual = jest.requireActual('@/lib/format');
    return { ...actual, fmtMoney: jest.fn(actual.fmtMoney) };
});
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('@/lib/feedback', () => ({
    soundEnabled: () => false,
    setSoundEnabled: jest.fn(),
    tick: jest.fn(),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const products = [
    { id: 'pa', name: 'Sopa', price: 11.11, is_available: true, category_id: 'c1' },
    { id: 'pb', name: 'Lomo', price: 22.22, is_available: true, category_id: 'c1' },
    { id: 'pc', name: 'Flan', price: 33.33, is_available: true, category_id: 'c1' },
];

const rendersOf = (price) => fmtMoney.mock.calls.filter(([value]) => value === price).length;

// A parent that behaves like the real screens: every tap changes the order and
// hands the composer brand-new callbacks.
function Harness({ extraProps = {} }) {
    const [lines, setLines] = useState([]);
    const add = (product) => setLines((prev) => {
        const line = prev.find((l) => l.product_id === product.id);
        if (line) return prev.map((l) => (l === line ? { ...l, quantity: l.quantity + 1 } : l));
        return [...prev, {
            id: `l-${product.id}`, product_id: product.id, product_name: product.name, quantity: 1, unit_price: product.price, status: 'borrador', notes: null,
        }];
    });
    const remove = (product) => setLines((prev) => prev
        .map((l) => (l.product_id === product.id ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0));
    return (
        <OrderComposer
            order={{ id: 'o1', order_number: 1, status: 'nuevo', total: 0 }}
            items={lines}
            products={products}
            canCompose
            showActions={false}
            onAddProduct={add}
            onRemoveProduct={remove}
            {...extraProps}
        />
    );
}

describe('OrderComposer card renders (CP-01)', () => {
    let host;
    let root;

    beforeEach(async () => {
        const actual = jest.requireActual('@/lib/format');
        fmtMoney.mockReset().mockImplementation(actual.fmtMoney);
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    const q = (id) => host.querySelector(`[data-testid="mesa-sheet-${id}"]`);

    it('tapping a card re-renders that card only', async () => {
        await act(async () => root.render(<Harness />));
        expect(rendersOf(11.11)).toBeGreaterThan(0);
        fmtMoney.mockClear();

        await act(async () => q('producto-nombre-pa').click());

        expect(q('producto-cantidad-pa').textContent).toBe('1');
        expect(rendersOf(11.11)).toBeGreaterThan(0);
        expect(rendersOf(22.22)).toBe(0);
        expect(rendersOf(33.33)).toBe(0);
    });

    it('the stepper + and - also leave the other cards alone', async () => {
        await act(async () => root.render(<Harness />));
        await act(async () => q('producto-nombre-pb').click());
        fmtMoney.mockClear();

        await act(async () => q('producto-pb').click());
        expect(q('producto-cantidad-pb').textContent).toBe('2');
        expect(rendersOf(11.11)).toBe(0);
        expect(rendersOf(33.33)).toBe(0);

        fmtMoney.mockClear();
        await act(async () => q('producto-menos-pb').click());
        expect(q('producto-cantidad-pb').textContent).toBe('1');
        expect(rendersOf(11.11)).toBe(0);
        expect(rendersOf(33.33)).toBe(0);
    });

    it('a busy composer (saving) still re-renders every card so they disable together', async () => {
        await act(async () => root.render(<Harness />));
        fmtMoney.mockClear();
        await act(async () => root.render(<Harness extraProps={{ savingItem: true }} />));
        expect(q('producto-pa').disabled).toBe(true);
        expect(q('producto-pc').disabled).toBe(true);
    });
});
