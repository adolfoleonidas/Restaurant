/**
 * BS-03: where the waiter reads that their taps are not on the server yet.
 * The person strip (table sheet) and the composer footer (new order sheet) show
 * the state the outbox reports; the cards and everything else are untouched.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OrderComposer from '@/components/OrderComposer';
import PersonStrip from '@/pages/salon/PersonStrip';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('@/lib/feedback', () => ({
    soundEnabled: () => false,
    setSoundEnabled: jest.fn(),
    tick: jest.fn(),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const order = {
    id: 'o1', order_number: 7, status: 'nuevo', total: 24, items: [],
};
const draft = [{
    id: 'i1', product_id: 'p1', product_name: 'Sopa', quantity: 2, unit_price: 12, subtotal: 24, status: 'borrador', notes: null,
}];

describe('saving state on screen', () => {
    let host;
    let root;
    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });
    const show = (element) => act(async () => root.render(element));
    const status = (id) => host.querySelector(`[data-testid="${id}"]`);

    describe('the person strip', () => {
        const strip = (extra) => (
            <PersonStrip
                personNameEdit={false}
                aliasDraft="Juan"
                setAliasDraft={() => {}}
                setPersonNameEdit={() => {}}
                saveAlias={() => {}}
                setSharedDraft={() => {}}
                sharedDraft={false}
                order={order}
                t={{ number: 1 }}
                canTake
                {...extra}
            />
        );

        it.each([
            ['saving', 'Guardando…'],
            ['unsaved', 'Sin guardar'],
            ['idle', ''],
        ])('says %s as "%s"', async (state, text) => {
            await show(strip({ saveState: state }));
            expect(status('mesa-sheet-sync').textContent).toBe(text);
        });

        it('sits in the strip, next to the rename button, where the waiter looks while tapping', async () => {
            await show(strip({ saveState: 'unsaved' }));
            const bar = host.querySelector('[data-testid="mesa-sheet-persona"]');
            const rename = bar.querySelector('[data-testid="mesa-sheet-persona-renombrar"]');
            expect(bar.contains(status('mesa-sheet-sync'))).toBe(true);
            expect(rename.parentElement.contains(status('mesa-sheet-sync'))).toBe(true);
            expect(bar.textContent).toContain('Para Juan');
        });

        it('is quiet by default', async () => {
            await show(strip());
            expect(status('mesa-sheet-sync').textContent).toBe('');
        });

        it('steps aside while the name is being edited', async () => {
            await show(strip({ personNameEdit: true, saveState: 'unsaved' }));
            expect(status('mesa-sheet-sync')).toBeNull();
            expect(host.querySelector('[data-testid="mesa-sheet-persona-nombre"]')).not.toBeNull();
        });
    });

    describe('the composer footer', () => {
        const composer = (extra) => (
            <OrderComposer
                order={order}
                items={draft}
                products={[{ id: 'p1', name: 'Sopa', price: 12, is_available: true }]}
                canCompose
                testIdPrefix="nuevo-pedido"
                {...extra}
            />
        );

        it('shows the state next to the total of the account', async () => {
            await show(composer({ saveState: 'saving' }));
            const text = status('nuevo-pedido-sync');
            expect(text.textContent).toBe('Guardando…');
            expect(host.querySelector('[data-testid="nuevo-pedido-pedido-resumen"]').contains(text)).toBe(true);
        });

        it('says nothing when everything is saved', async () => {
            await show(composer({ saveState: 'idle' }));
            expect(status('nuevo-pedido-sync').textContent).toBe('');
        });

        it('has no footer, so no state, when the screen shows its own actions', async () => {
            await show(composer({ saveState: 'unsaved', showActions: false }));
            expect(status('nuevo-pedido-sync')).toBeNull();
        });
    });
});
