import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CobrarDialog from '@/components/CobrarDialog';
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

async function typeValue(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
}

let view;
const onOpenChange = jest.fn();

async function payInFull() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    view = { host, root };
    await act(async () => root.render(<CobrarDialog open onOpenChange={onOpenChange} order={order} onPaid={jest.fn()} />));
    await flush();
    await typeValue(q('caja-recibido-input'), '25');
    await click(q('caja-cobrar-submit-button'));
    await click(q('caja-verificar-check'));
    await click(q('caja-verificar-registrar'));
    await flush();
}

beforeEach(() => {
    onOpenChange.mockClear();
    api.get.mockReset().mockImplementation((path) => Promise.resolve({
        data: path === '/orders/order-1' ? { ...order, status: 'pagado', payment_status: 'pagado', amount_paid: 25 }
            : path === '/restaurants/current' ? { name: 'Casa Andina' } : {},
    }));
    api.post.mockReset().mockResolvedValue({ data: { fully_paid: true, remaining: 0, change_amount: 0, amount: 25 } });
});

afterEach(async () => {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
});

describe('charge dialog after a registered payment', () => {
    it('Finalizar closes the dialog', async () => {
        await payInFull();
        expect(q('caja-pago-ok')).not.toBeNull();
        expect(q('caja-cobrar-submit-button').textContent).toContain('Finalizar');
        await click(q('caja-cobrar-submit-button'));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('"Total pagado" shows the amount that was paid', async () => {
        await payInFull();
        const hero = document.body.querySelector('.pay-hero');
        expect(hero.textContent).toContain('Total pagado');
        expect(hero.querySelector('output').textContent).toBe('S/ 25.00');
    });

    it('disables the method picker once paid', async () => {
        await payInFull();
        const methods = document.body.querySelectorAll('.method-rail button.method');
        expect(methods.length).toBeGreaterThan(0);
        methods.forEach((button) => expect(button.disabled).toBe(true));
    });

    it('prints the receipt with the restaurant name from settings', async () => {
        const write = jest.fn();
        window.open = jest.fn(() => ({ document: { write, close: jest.fn() }, focus: jest.fn(), print: jest.fn() }));
        await payInFull();
        await click(q('caja-imprimir'));
        expect(write.mock.calls[0][0]).toContain('<h1>Casa Andina</h1>');
    });
});
