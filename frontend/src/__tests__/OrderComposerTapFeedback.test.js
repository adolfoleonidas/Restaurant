/**
 * CP-03 + NA-01: tap feedback is CSS only and has no motion. The card changes
 * colour the instant it is pressed (`:active`, background and border; it never
 * moves, scales or transitions) instead of a React-state pulse that cost two
 * extra commits and a timer per tap; controls opt out of the double-tap-zoom
 * delay.
 */
import React, { Profiler, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'fs';
import path from 'path';
import OrderComposer from '@/components/OrderComposer';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('@/lib/feedback', () => ({
    soundEnabled: () => false,
    setSoundEnabled: jest.fn(),
    tick: jest.fn(),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const products = [
    { id: 'pa', name: 'Sopa', price: 11, is_available: true, category_id: 'c1' },
    { id: 'pb', name: 'Lomo', price: 22, is_available: true, category_id: 'c1' },
];

const commits = { count: 0 };

function Harness() {
    const [lines, setLines] = useState([]);
    const add = (product) => setLines((prev) => [...prev, {
        id: `l${prev.length}`, product_id: product.id, product_name: product.name, quantity: 1, unit_price: product.price, status: 'borrador', notes: null,
    }]);
    return (
        <Profiler id="composer" onRender={() => { commits.count += 1; }}>
            <OrderComposer
                order={{ id: 'o1', order_number: 1, status: 'nuevo', total: 0 }}
                items={lines}
                products={products}
                canCompose
                showActions={false}
                onAddProduct={add}
                onRemoveProduct={() => {}}
            />
        </Profiler>
    );
}

describe('OrderComposer tap feedback (CP-03)', () => {
    let host;
    let root;

    beforeEach(async () => {
        jest.useFakeTimers();
        commits.count = 0;
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<Harness />));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        jest.useRealTimers();
    });

    const q = (id) => host.querySelector(`[data-testid="mesa-sheet-${id}"]`);

    it('a tap commits once and leaves no timer behind (no pulse state)', async () => {
        commits.count = 0;
        const timers = jest.spyOn(global, 'setTimeout');
        await act(async () => q('producto-nombre-pa').click());
        expect(commits.count).toBe(1);
        expect(host.querySelector('.composer-pulse')).toBeNull();
        // The old pulse cleared itself with a 260 ms timer.
        expect(timers.mock.calls.filter(([, delay]) => delay === 260)).toHaveLength(0);
        timers.mockRestore();

        await act(async () => { jest.advanceTimersByTime(500); });
        expect(commits.count).toBe(1);
    });

    it('the card carries the CSS press effect and the controls skip the double-tap delay', () => {
        const card = q('producto-fila-pa');
        expect(card.className).toContain('composer-card');
        expect(card.className).not.toContain('transition-colors');
        ['producto-nombre-pa', 'producto-menos-pa', 'producto-pa'].forEach((id) => {
            expect(q(id).className).toContain('touch-manipulation');
        });
        // Accessible names and test ids are untouched.
        expect(q('producto-pa').getAttribute('aria-label')).toBe('Agregar uno de Sopa');
        expect(q('producto-menos-pa').getAttribute('aria-label')).toBe('Quitar uno de Sopa');
    });

    it('index.css presses with an instant background and border change, never a move or a scale', () => {
        const css = fs.readFileSync(path.resolve(__dirname, '..', 'index.css'), 'utf8');
        expect(css).not.toContain('composer-pulse');
        const pressed = css.match(/\.composer-card:active\s*\{[^}]*\}/)[0];
        expect(pressed).toMatch(/background-color:\s*hsl\(var\(--muted\)\)/);
        expect(pressed).toMatch(/border-color:\s*hsl\(var\(--primary\)\)/);
        expect(pressed).not.toMatch(/transform|scale|translate|transition|animation/);
        // The resting card declares no transition either: nothing eases in or out.
        const resting = css.match(/\.composer-card\s*\{[^}]*\}/);
        expect(resting === null || !/transition|animation|transform/.test(resting[0])).toBe(true);
        expect(css).not.toMatch(/\.composer-card[^{]*\{[^}]*(transition|animation)\s*:/);
    });
});
