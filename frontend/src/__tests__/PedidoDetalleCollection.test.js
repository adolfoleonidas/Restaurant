import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PedidoDetalle from '@/pages/PedidoDetalle';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;
const originalFileReader = global.FileReader;

const mockUser = { id: 'waiter-1', role: 'mozo', functions: ['atencion', 'cobro'] };
const mockOrder = {
    id: 'order-1', order_number: 17, status: 'pendiente_pago', payment_status: 'pendiente',
    acceptance_status: 'aceptado', attention_number: 6, attention_business_date: '2026-10-02', branch_id: 'branch-1',
    order_type: 'local', subtotal: 25, total: 25, amount_paid: 0, updated_at: 'stamp',
    items: [{ id: 'item-1', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, paid_qty: 0 }],
};
let mockRegister = { id: 'register-1', status: 'open' };
const mockParams = { id: 'order-1' };
const mockCollectionConfig = {
    yape: { enabled: true, number: '900111222', holder: 'Ada', qr: 'data:image/png;base64,yape-image' },
    plin: { enabled: true, number: '900333444', holder: 'Ada', qr: 'data:image/png;base64,plin-image' },
};

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const source = fetcher.toString();
        if (source.includes('getOrder')) return { data: mockOrder, refetch: mockOrderRefetch };
        return { data: [], refetch: jest.fn() };
    },
}));
jest.mock('react-router-dom', () => ({
    useParams: () => mockParams,
    useNavigate: () => mockNavigate,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mockNavigate = jest.fn();
const mockOrderRefetch = jest.fn();
const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

async function renderDetail() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<PedidoDetalle />));
    return { host, root };
}

async function click(element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
}

// CobrarDialog (redesign) requires React-compatible text entry and an explicit
// verify step: footer "Registrar" opens the confirmation sheet, then the checkbox
// unlocks "caja-verificar-registrar", which finally POSTs /payments.
async function typeValue(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
}

async function confirmVerifySheet() {
    await click(document.body.querySelector('[data-testid="caja-verificar-check"]'));
    await click(document.body.querySelector('[data-testid="caja-verificar-registrar"]'));
}

async function cleanup(view) {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
}

describe('PedidoDetalle collection entry', () => {
    beforeEach(() => {
        mockUser.id = 'waiter-1';
        mockUser.role = 'mozo';
        mockUser.functions = ['atencion', 'cobro'];
        mockParams.id = 'order-1';
        mockOrder.id = 'order-1';
        mockOrder.amount_paid = 0;
        mockRegister = { id: 'register-1', status: 'open' };
        mockNavigate.mockReset();
        mockOrderRefetch.mockReset();
        api.get.mockReset().mockImplementation((path) => Promise.resolve({
            data: path === '/cash/current' ? mockRegister
                : path === '/payment-config/collection' ? mockCollectionConfig
                    : path === '/orders/order-1' ? { ...mockOrder, updated_at: 'fresh-stamp' } : [],
        }));
        api.post.mockReset().mockResolvedValue({ data: { fully_paid: true, remaining: 0, change_amount: 0 } });
        toast.error.mockClear();
    });

    afterEach(() => {
        global.FileReader = originalFileReader;
        document.body.innerHTML = '';
    });

    it('opens the shared collection dialog inline for a Cobro-authorized mozo with an active register', async () => {
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        expect(api.get).toHaveBeenCalledWith('/cash/current');
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).not.toBeNull();
        expect(view.host.textContent).toContain('Atención 6 · 2026-10-02 · branch-1');
        await typeValue(document.body.querySelector('[data-testid="caja-recibido-input"]'), '25');
        await click(document.body.querySelector('[data-testid="caja-cobrar-submit-button"]'));
        await confirmVerifySheet();
        await flush();
        expect(api.post).toHaveBeenCalledWith('/payments', expect.objectContaining({
            order_id: 'order-1', method: 'efectivo', amount: 25, expected_updated_at: 'stamp', expected_total: 25,
        }));
        expect(document.body.querySelector('[data-testid="caja-pago-ok"]')).not.toBeNull();
        expect(mockOrderRefetch).toHaveBeenCalled();
        mockOrder.amount_paid = 25;
        await act(async () => view.root.render(<PedidoDetalle />));
        expect(document.body.querySelector('[data-testid="caja-pago-ok"]')).not.toBeNull();
        await cleanup(view);
    });

    it('keeps proof upload separate from payment, refreshes the order, and binds the next payment to that snapshot', async () => {
        global.FileReader = class {
            readAsDataURL() {
                this.result = 'data:image/png;base64,iVBORw0KGgo=';
                this.onload?.();
            }
        };
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        const yape = document.body.querySelector('[data-testid="caja-metodo-yape"]');
        await act(async () => {
            yape.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            yape.click();
        });
        await flush();
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        await click(document.body.querySelector('[data-testid="caja-enviar-comprobante"]'));
        expect(api.post).toHaveBeenCalledWith('/payments/order-1/proof', {
            method: 'yape', payment_proof: 'data:image/png;base64,iVBORw0KGgo=',
        });
        expect(api.post.mock.calls.some(([path]) => path === '/payments')).toBe(false);
        expect(api.get).toHaveBeenCalledWith('/orders/order-1');
        expect(document.body.textContent).toContain('PagadoS/ 0.00');
        expect(document.body.textContent).toContain('pendiente de verificación');

        for (const method of ['plin', 'yape']) {
            const tab = document.body.querySelector(`[data-testid="caja-metodo-${method}"]`);
            await act(async () => {
                tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
                tab.click();
            });
            await flush();
        }
        await click(document.body.querySelector('[data-testid="caja-cobrar-submit-button"]'));
        await confirmVerifySheet();
        const payment = api.post.mock.calls.find(([path]) => path === '/payments');
        expect(payment[1]).toMatchObject({ order_id: 'order-1', expected_updated_at: 'fresh-stamp', expected_total: 25, amount: 25 });
        expect(mockOrderRefetch).toHaveBeenCalled();
        await cleanup(view);
    });

    it('preserves the Caja deep-link fallback when no register is active', async () => {
        // Ruteo explícito: el hook de features también consulta /restaurants/current.
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/restaurants/current' ? { features: {} }
                : path === '/cash/current' ? null
                    : path === '/orders/order-1' ? mockOrder : [],
        }));
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        expect(mockNavigate).toHaveBeenCalledWith('/caja?order=order-1');
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).toBeNull();
        await cleanup(view);
    });

    it('closes collection when the register is closed during the dialog and installs the 12-second check', async () => {
        const timerSpy = jest.spyOn(global, 'setInterval');
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).not.toBeNull();
        const registerCheck = timerSpy.mock.calls.find(([, interval]) => interval === 12000);
        expect(registerCheck).toBeDefined();
        mockRegister = { id: 'register-1', status: 'closed' };
        await act(async () => registerCheck[0]());
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).toBeNull();
        timerSpy.mockRestore();
        await cleanup(view);
    });

    it('invalidates a pending register lookup when the route changes to another order', async () => {
        let resolveRegister;
        api.get.mockImplementation((path) => path === '/cash/current'
            ? new Promise((resolve) => { resolveRegister = resolve; })
            : Promise.resolve({ data: path === '/orders/order-1' ? mockOrder : [] }));
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        mockParams.id = 'order-2';
        mockOrder.id = 'order-2';
        await act(async () => view.root.render(<PedidoDetalle />));
        await act(async () => resolveRegister({ data: { id: 'register-1', status: 'open' } }));
        await flush();
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).toBeNull();
        expect(mockNavigate).not.toHaveBeenCalled();
        await cleanup(view);
    });

    it('closes collection and invalidates its polling when Cobro authorization is lost', async () => {
        const timerSpy = jest.spyOn(global, 'setInterval');
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        const registerCheck = timerSpy.mock.calls.find(([, interval]) => interval === 12000);
        expect(registerCheck).toBeDefined();
        mockUser.functions = ['atencion'];
        await act(async () => view.root.render(<PedidoDetalle />));
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).toBeNull();
        timerSpy.mockRestore();
        await cleanup(view);
    });

    it('does not open collection after an active-register lookup resolves after unmount', async () => {
        let resolveRegister;
        api.get.mockImplementation((path) => path === '/cash/current'
            ? new Promise((resolve) => { resolveRegister = resolve; })
            : Promise.resolve({ data: path === '/orders/order-1' ? mockOrder : [] }));
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        await cleanup(view);
        await act(async () => resolveRegister({ data: { id: 'register-1', status: 'open' } }));
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).toBeNull();
    });

    it('fails closed when checking the active register fails', async () => {
        api.get.mockImplementation((path) => {
            if (path === '/restaurants/current') return Promise.resolve({ data: { features: {} } });
            if (path === '/cash/current') return Promise.reject(new Error('register lookup failed'));
            return Promise.resolve({ data: path === '/orders/order-1' ? mockOrder : [] });
        });
        const view = await renderDetail();
        await click(view.host.querySelector('[data-testid="pedido-cobrar-button"]'));
        expect(mockNavigate).not.toHaveBeenCalled();
        expect(document.body.querySelector('[data-testid="caja-cobrar-dialog"]')).toBeNull();
        expect(toast.error).toHaveBeenCalled();
        await cleanup(view);
    });

    it('does not expose collection to a mozo without the Cobro function', async () => {
        mockUser.functions = ['atencion'];
        const view = await renderDetail();
        expect(view.host.querySelector('[data-testid="pedido-cobrar-button"]')).toBeNull();
        expect(api.get).not.toHaveBeenCalledWith('/cash/current');
        await cleanup(view);
    });

    it('sin la flag `item_void` no muestra el ✕ de cancelar por ítem', async () => {
        const originalItems = mockOrder.items;
        mockOrder.items = [{ id: 'item-2', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, paid_qty: 0, status: 'pendiente' }];
        try {
            const view = await renderDetail();
            expect(view.host.querySelector('[data-testid="pedido-item-cancel-item-2"]')).toBeNull();
            await cleanup(view);
        } finally {
            mockOrder.items = originalItems;
        }
    });

    it('con la flag `item_void` activa el ✕ aparece y anular sigue funcionando', async () => {
        const originalItems = mockOrder.items;
        mockOrder.items = [{ id: 'item-2', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, paid_qty: 0, status: 'pendiente' }];
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/restaurants/current' ? { features: { item_void: true } }
                : path === '/cash/current' ? mockRegister
                    : path === '/payment-config/collection' ? mockCollectionConfig
                        : path === '/orders/order-1' ? mockOrder : [],
        }));
        try {
            const view = await renderDetail();
            const cancel = view.host.querySelector('[data-testid="pedido-item-cancel-item-2"]');
            expect(cancel).not.toBeNull();
            await click(cancel);
            // Ítem enviado: no se borra, se anula con motivo.
            expect(api.post).toHaveBeenCalledWith('/orders/order-1/items/item-2/void', { reason: 'Anulado desde el detalle del pedido' });
            await cleanup(view);
        } finally {
            mockOrder.items = originalItems;
        }
    });

    it('offers "Anular pedido" in the destructive style', async () => {
        mockUser.role = 'admin';
        const view = await renderDetail();
        await flush();
        const cancel = view.host.querySelector('[data-testid="pedido-cancelar-button"]');
        expect(cancel).not.toBeNull();
        expect(cancel.className).toContain('text-destructive');
        expect(cancel.className).toContain('border-destructive');
        await cleanup(view);
    });
});
