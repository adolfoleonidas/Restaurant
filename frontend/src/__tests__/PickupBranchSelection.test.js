import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Checkout from '@/pages/Checkout';
import Configuracion from '@/pages/Configuracion';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;
const mockCart = [{ product_id: 'dish-1', name: 'Sopa', quantity: 1, price: 12 }];
const mockClear = jest.fn();
const mockSetMeta = jest.fn();
const mockSearchParams = new URLSearchParams('?tipo=recojo');

jest.mock('@/contexts/CartContext', () => ({ useCart: () => ({ items: mockCart, subtotal: 12, clear: mockClear }) }));
jest.mock('@/contexts/LiveOrderContext', () => ({ useLiveOrder: () => ({ setMeta: mockSetMeta, isActive: false }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/TableQrActions', () => () => null);
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
async function unmount(view) { await act(async () => view.root.unmount()); view.host.remove(); }
async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); }); }
async function setInput(host, testId, value) {
    await act(async () => {
        const input = host.querySelector(`[data-testid="${testId}"]`);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('pickup branch selection and administration', () => {
    beforeEach(() => {
        sessionStorage.clear();
        api.get.mockReset().mockImplementation((path) => Promise.resolve({ data:
            path === '/public/restaurant' ? { require_table_qr: false } :
            path === '/public/payment-config' ? { enable_efectivo: true } :
            path === '/public/pickup-branches' ? [{ id: 'branch-a', name: 'Centro' }] :
            path === '/restaurants/current' ? { name: 'Casa' } :
            path === '/branches' ? [{ id: 'branch-a', name: 'Centro', timezone: 'America/Lima', business_day_cutoff: '03:30', pickup_enabled: false }] :
            path === '/zones' ? [] : path === '/tables' ? [] : [] }));
        api.post.mockReset().mockResolvedValue({ data: { id: 'branch-new' } });
        api.patch.mockReset().mockResolvedValue({ data: { id: 'branch-a' } });
        toast.error.mockClear(); toast.success.mockClear(); mockClear.mockClear(); mockSetMeta.mockClear();
        Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => 'abcd1234-abcd-4abc-8abc-abcd1234abcd' } });
        window.scrollTo = jest.fn();
    });

    it('requires explicit selection even when one pickup branch is available and submits the selected branch', async () => {
        const view = await mount(<Checkout />);
        const submit = view.host.querySelector('[data-testid="checkout-confirmar-button"]');
        expect(view.host.querySelector('[data-testid="checkout-pickup-branch"]')).not.toBeNull();
        expect(submit.disabled).toBe(true);
        const select = view.host.querySelector('[data-testid="checkout-pickup-branch"]');
        await act(async () => { select.value = 'branch-a'; select.dispatchEvent(new Event('change', { bubbles: true })); });
        await act(async () => {
            for (const [testId, value] of [['checkout-nombre', 'Ana'], ['checkout-celular', '999']]) {
                const input = view.host.querySelector(`[data-testid="${testId}"]`);
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        expect(submit.disabled).toBe(false);
        await click(submit);
        expect(api.post).toHaveBeenCalledWith('/public/orders', expect.objectContaining({ order_type: 'recojo', branch_id: 'branch-a' }));
        await unmount(view);
    });

    it('shows an empty/error availability state and keeps pickup submission disabled', async () => {
        api.get.mockImplementation((path) => path === '/public/pickup-branches'
            ? Promise.resolve({ data: [] })
            : Promise.resolve({ data: path === '/public/restaurant' ? {} : path === '/public/payment-config' ? { enable_efectivo: true } : [] }));
        const view = await mount(<Checkout />);
        expect(view.host.textContent).toContain('No hay sucursales disponibles para recojo');
        expect(view.host.querySelector('[data-testid="checkout-confirmar-button"]').disabled).toBe(true);
        await unmount(view);
        api.get.mockImplementation((path) => path === '/public/pickup-branches' ? Promise.reject(new Error('offline'))
            : Promise.resolve({ data: path === '/public/restaurant' ? {} : path === '/public/payment-config' ? { enable_efectivo: true } : [] }));
        const failed = await mount(<Checkout />);
        expect(failed.host.textContent).toContain('No se pudieron cargar las sucursales');
        expect(failed.host.querySelector('[data-testid="checkout-confirmar-button"]').disabled).toBe(true);
        await unmount(failed);
    });

    it('lets administrators save explicit branch pickup availability and cutoff settings', async () => {
        const view = await mount(<Configuracion />);
        const toggle = view.host.querySelector('[data-testid="branch-pickup-enabled-branch-a"]');
        expect(toggle).not.toBeNull();
        await act(async () => { toggle.click(); });
        await click(view.host.querySelector('[data-testid="branch-save-branch-a"]'));
        expect(api.patch).toHaveBeenCalledWith('/branches/branch-a', expect.objectContaining({ pickup_enabled: true, timezone: 'America/Lima', business_day_cutoff: '03:30' }));
        await unmount(view);
    });

    it('requires an explicit timezone and cutoff when creating a pickup branch', async () => {
        const view = await mount(<Configuracion />);
        expect(view.host.querySelector('[data-testid="branch-create"]').disabled).toBe(true);
        await setInput(view.host, 'branch-new-name', 'Sur');
        await setInput(view.host, 'branch-new-timezone', 'America/Lima');
        await setInput(view.host, 'branch-new-cutoff', '03:15');
        const checkbox = view.host.querySelector('[data-testid="branch-pickup-enabled-new"]');
        await act(async () => { checkbox.click(); });
        await click(view.host.querySelector('[data-testid="branch-create"]'));
        expect(api.post).toHaveBeenCalledWith('/branches', {
            name: 'Sur', timezone: 'America/Lima', business_day_cutoff: '03:15', pickup_enabled: true,
        });
        await unmount(view);
    });
});
