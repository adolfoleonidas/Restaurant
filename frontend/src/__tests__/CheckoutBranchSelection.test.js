import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = [{ product_id: 'dish-1', name: 'Soup', quantity: 1, price: 12 }];
const mockClear = jest.fn();
const mockSetMeta = jest.fn();
const mockSearchParams = new URLSearchParams('?tipo=delivery');

jest.mock('@/contexts/CartContext', () => ({ useCart: () => ({ items: mockCart, subtotal: 12, clear: mockClear }) }));
jest.mock('@/contexts/LiveOrderContext', () => ({ useLiveOrder: () => ({ setMeta: mockSetMeta, isActive: false }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
    useSearchParams: () => [mockSearchParams],
}));

async function mount(node) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(node); await Promise.resolve(); await Promise.resolve(); });
    return { host, root };
}

async function unmount(view) {
    await act(async () => view.root.unmount());
    view.host.remove();
}

async function setInput(host, testId, value) {
    await act(async () => {
        const input = host.querySelector(`[data-testid="${testId}"]`);
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('delivery branch selection', () => {
    beforeEach(() => {
        sessionStorage.clear();
        api.get.mockReset().mockImplementation((path) => Promise.resolve({ data:
            path === '/public/restaurant' ? { require_table_qr: false } :
            path === '/public/payment-config' ? { enable_efectivo: true } :
            path === '/public/delivery-branches' ? [{ id: 'branch-a', name: 'Centro' }] : [] }));
        api.post.mockReset().mockResolvedValue({ data: { id: 'order-a', tracking_code: 'TRACK1', order_number: 1, total: 17 } });
        mockClear.mockClear();
        mockSetMeta.mockClear();
        Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'abcd1234-abcd-4abc-8abc-abcd1234abcd' } });
        window.scrollTo = jest.fn();
    });

    it('requires an explicit branch even when only one delivery branch is listed and submits it', async () => {
        const view = await mount(<Checkout />);
        const select = view.host.querySelector('[data-testid="checkout-delivery-branch"]');
        const submit = view.host.querySelector('[data-testid="checkout-confirmar-button"]');
        expect(select).not.toBeNull();
        expect(select.value).toBe('');
        for (const [testId, value] of [['checkout-nombre', 'Ana'], ['checkout-celular', '999'], ['checkout-direccion', 'Main Street 10']]) {
            await setInput(view.host, testId, value);
        }
        expect(submit.disabled).toBe(true);

        await act(async () => {
            select.value = 'branch-a';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(submit.disabled).toBe(false);
        await act(async () => { submit.click(); await Promise.resolve(); await Promise.resolve(); });
        // El primer paso es la revisión del pedido; el segundo confirma y envía.
        const pay = view.host.querySelector('[data-testid="checkout-pay-button"]');
        expect(pay).not.toBeNull();
        await act(async () => { pay.click(); await Promise.resolve(); await Promise.resolve(); });
        expect(api.post).toHaveBeenCalledWith('/public/orders', expect.objectContaining({ order_type: 'delivery', branch_id: 'branch-a' }));
        await unmount(view);
    });

    it('keeps delivery unavailable when the branch list fails or is empty', async () => {
        api.get.mockImplementation((path) => Promise.resolve({ data:
            path === '/public/restaurant' ? {} : path === '/public/payment-config' ? { enable_efectivo: true } : [] }));
        const empty = await mount(<Checkout />);
        expect(empty.host.textContent).toContain('No hay sucursales disponibles para delivery');
        await unmount(empty);

        api.get.mockImplementation((path) => path === '/public/delivery-branches' ? Promise.reject(new Error('offline'))
            : Promise.resolve({ data: path === '/public/restaurant' ? {} : path === '/public/payment-config' ? { enable_efectivo: true } : [] }));
        const failed = await mount(<Checkout />);
        expect(failed.host.textContent).toContain('No se pudieron cargar las sucursales');
        expect(failed.host.querySelector('[data-testid="checkout-confirmar-button"]').disabled).toBe(true);
        await unmount(failed);
    });
});
