import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CobrarDialog from '@/components/CobrarDialog';
import VerifyDialog from '@/components/cobro/VerifyDialog';
import HelpDialog from '@/components/cobro/HelpDialog';
import HistoryDialog from '@/components/cobro/HistoryDialog';
import QrDialog from '@/components/cobro/QrDialog';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockUser = { id: 'cashier-1', role: 'cajero', functions: ['cobro'], restaurant_id: 'r1' };
const order = {
    id: 'order-1', order_number: 17, status: 'pendiente_pago', payment_status: 'pendiente',
    order_type: 'local', subtotal: 25, total: 25, amount_paid: 0, updated_at: 'stamp',
    items: [{ id: 'item-1', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, paid_qty: 0 }],
};

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const click = async (node) => { await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await flush(); };
const q = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const press = async (target, key, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    await act(async () => { target.dispatchEvent(event); });
    return event;
};

// jsdom has no layout, so every element reports no client rects and the focus trap
// would see nothing to trap. Pretend everything is rendered.
const realGetClientRects = Element.prototype.getClientRects;
beforeAll(() => { Element.prototype.getClientRects = function fake() { return [{}]; }; });
afterAll(() => { Element.prototype.getClientRects = realGetClientRects; });

let view;
async function mount(element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    view = { host, root };
    await act(async () => root.render(element));
    await flush();
}

afterEach(async () => {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
});

describe.each([
    ['VerifyDialog', (close) => (
        <VerifyDialog chargeAmount={25} handleConfirm={jest.fn()} method="efectivo" setShowVerify={close} setVerified={jest.fn()}
            verified={false} verifyContext="" verifyCopy="Confirmo" verifyWarning="Ojo" />
    )],
    ['HelpDialog', (close) => <HelpDialog setShowHelp={close} />],
    ['HistoryDialog', (close) => <HistoryDialog paid={0} remaining={25} setShowHistory={close} />],
    ['QrDialog', (close) => <QrDialog backendMethod="yape" setShowQr={close} walletConfig={{ qr: 'data:image/png;base64,AA==' }} />],
])('%s as a contained sub-dialog', (name, render) => {
    function Harness() {
        const [open, setOpen] = useState(false);
        return (
            <>
                <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>abrir</button>
                {open && render(() => setOpen(false))}
            </>
        );
    }

    async function open() {
        await mount(<Harness />);
        q('trigger').focus();
        await click(q('trigger'));
    }

    it('moves focus into the sub-dialog when it opens', async () => {
        await open();
        const dialog = document.body.querySelector('.cobro-subdialog');
        expect(dialog).not.toBeNull();
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('Escape closes only the sub-dialog and does not reach the parent', async () => {
        await open();
        const reachedDocument = jest.fn();
        document.addEventListener('keydown', reachedDocument);
        const event = await press(document.activeElement, 'Escape');
        document.removeEventListener('keydown', reachedDocument);
        expect(document.body.querySelector('.cobro-subdialog')).toBeNull();
        expect(event.defaultPrevented).toBe(true);
        expect(reachedDocument).not.toHaveBeenCalled();
    });

    it('returns focus to the trigger when it closes', async () => {
        await open();
        expect(document.activeElement).not.toBe(q('trigger')); // it had left the trigger
        await press(document.activeElement, 'Escape');
        expect(document.activeElement).toBe(q('trigger'));
    });

    it(`${name} close button also returns focus to the trigger`, async () => {
        await open();
        expect(document.activeElement).not.toBe(q('trigger'));
        document.body.querySelector('.cobro-subdialog .icon-button')?.click();
        await flush();
        expect(document.body.querySelector('.cobro-subdialog')).toBeNull();
        expect(document.activeElement).toBe(q('trigger'));
    });
});

describe('sub-dialog inside the charge dialog', () => {
    const onOpenChange = jest.fn();

    async function openVerify() {
        await mount(<CobrarDialog open onOpenChange={onOpenChange} order={order} onPaid={jest.fn()} />);
        await act(async () => {
            const input = q('caja-recibido-input');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '25');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await flush();
        q('caja-cobrar-submit-button').focus();
        await click(q('caja-cobrar-submit-button'));
    }

    beforeEach(() => {
        onOpenChange.mockClear();
        api.get.mockReset().mockResolvedValue({ data: {} });
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    it('Escape with the verify step open closes the step, not the charge dialog', async () => {
        await openVerify();
        expect(document.body.querySelector('.cobro-subdialog')).not.toBeNull();
        await press(document.activeElement, 'Escape');
        expect(document.body.querySelector('.cobro-subdialog')).toBeNull();
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(q('caja-cobrar-dialog')).not.toBeNull();
    });

    it('a second Escape, with nothing else open, does close the charge dialog', async () => {
        await openVerify();
        await press(document.activeElement, 'Escape');
        await press(document.activeElement, 'Escape');
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('after the step closes focus is back on the button that opened it', async () => {
        await openVerify();
        expect(document.activeElement).not.toBe(q('caja-cobrar-submit-button'));
        await press(document.activeElement, 'Escape');
        expect(document.activeElement).toBe(q('caja-cobrar-submit-button'));
    });

    it('Tab cycles inside the open sub-dialog instead of the whole charge dialog', async () => {
        await openVerify();
        const sub = document.body.querySelector('.cobro-subdialog');
        const focusables = Array.from(sub.querySelectorAll('button, input')).filter((el) => !el.disabled);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        last.focus();
        const forward = await press(last, 'Tab');
        expect(forward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
        const backward = await press(first, 'Tab', { shiftKey: true });
        expect(backward.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
    });
});
