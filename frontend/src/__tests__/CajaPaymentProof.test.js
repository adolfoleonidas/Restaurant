import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Caja from '@/pages/Caja';
import { api } from '@/lib/api';
import { toast } from 'sonner';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockUser = { id: 'cashier-1', role: 'cajero', functions: ['cobro'] };
const mockOrder = {
    id: 'order-1', order_number: 17, status: 'pendiente_pago', payment_status: 'pendiente',
    order_type: 'local', subtotal: 25, total: 25, amount_paid: 0, updated_at: 'stamp',
    items: [{ id: 'item-1', product_name: 'Lomo', quantity: 1, unit_price: 25, subtotal: 25, paid_qty: 0 }],
};
const mockRegister = { id: 'register-1', status: 'open', opened_by_name: 'Ada', opened_at: '2026-10-01', opening_amount: 100 };
const mockCollectionConfig = {
    yape: { enabled: true, number: '900111222', holder: 'Ada', qr: 'data:image/png;base64,yape-image' },
    plin: { enabled: true, number: '900333444', holder: 'Ada', qr: 'data:image/png;base64,plin-image' },
};

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const source = fetcher.toString();
        // CajaWorkspace builds its fetchers through scopedGet(...), so match on the path alone.
        if (source.includes('/cash/current')) return { data: mockRegister, refetch: jest.fn() };
        if (source.includes('/orders')) return { data: [mockOrder], refetch: jest.fn() };
        if (source.includes('/tables')) return { data: [], refetch: jest.fn() };
        return { data: null, refetch: jest.fn() };
    },
}));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useSearchParams: () => [new URLSearchParams()],
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

async function openCollectionDialog() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Caja />));
    await act(async () => host.querySelector('[data-testid="caja-cobrar-17"]').click());
    await flush();
    return { host, root };
}

async function selectMethod(method) {
    await act(async () => {
        const tab = document.body.querySelector(`[data-testid="caja-metodo-${method}"]`);
        tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        tab.click();
    });
    await flush();
}

async function confirmVerifiedPayment() {
    await act(async () => document.body.querySelector('[data-testid="caja-cobrar-submit-button"]').click());
    await flush();
    const box = document.body.querySelector('[data-testid="caja-verificar-check"]');
    await act(async () => box.click());
    await flush();
    await act(async () => document.body.querySelector('[data-testid="caja-verificar-registrar"]').click());
    await flush();
}

async function cleanup(view) {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
}

describe('Caja QR and payment-proof collection', () => {
    let originalFileReader;

    beforeEach(() => {
        mockUser.id = 'cashier-1';
        mockUser.role = 'cajero';
        mockUser.functions = ['cobro'];
        mockOrder.payment_status = 'pendiente';
        mockOrder.amount_paid = 0;
        mockOrder.payment_proof_url = undefined;
        mockOrder.has_proof = undefined;
        mockOrder.payment_proof_method = undefined;
        api.get.mockReset().mockImplementation((path) => Promise.resolve({
            data: path === '/payment-config/collection' ? mockCollectionConfig
                : path.startsWith('/orders/') ? { ...mockOrder, updated_at: 'fresh-stamp' } : null,
        }));
        api.post.mockReset().mockResolvedValue({ data: { ok: true, payment_status: 'comprobante_subido' } });
        toast.error.mockClear();
        originalFileReader = global.FileReader;
        global.FileReader = class {
            readAsDataURL() {
                this.result = 'data:image/png;base64,iVBORw0KGgo=';
                this.onload?.();
            }
        };
    });

    afterEach(() => {
        global.FileReader = originalFileReader;
        document.body.innerHTML = '';
    });

    it('shows only the selected enabled method QR and account details', async () => {
        const view = await openCollectionDialog();
        await selectMethod('yape');
        expect(document.body.querySelector('[data-testid="caja-yape-qr"]')?.getAttribute('src')).toBe(mockCollectionConfig.yape.qr);
        expect(document.body.textContent).toContain('900111222');
        expect(document.body.querySelector('[data-testid="caja-plin-qr"]')).toBeNull();
        await selectMethod('plin');
        expect(document.body.querySelector('[data-testid="caja-plin-qr"]')?.getAttribute('src')).toBe(mockCollectionConfig.plin.qr);
        expect(document.body.querySelector('[data-testid="caja-yape-qr"]')).toBeNull();
        await cleanup(view);
    });

    it('shows the missing QR state but still permits proof attachment for an enabled account', async () => {
        // Por ruta, no por "la próxima llamada": la caja también pide la cola de
        // prepagos al montar, y un mock de un solo uso se lo llevaba esa petición.
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/payment-config/collection' ? {
                yape: { enabled: true, number: '900111222', holder: null, qr: null },
                plin: { enabled: false, number: null, holder: null, qr: null },
            } : null,
        }));
        const view = await openCollectionDialog();
        await selectMethod('yape');
        expect(document.body.textContent).toContain('No hay código QR configurado');
        expect(document.body.querySelector('[data-testid="comprobante-archivo"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="caja-enviar-comprobante"]')).not.toBeNull();
        await cleanup(view);
    });

    it('does not offer proof upload for a disabled method', async () => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/payment-config/collection' ? {
                yape: { enabled: false, number: null, holder: null, qr: null },
                plin: { enabled: false, number: null, holder: null, qr: null },
            } : null,
        }));
        const view = await openCollectionDialog();
        await selectMethod('yape');
        expect(document.body.textContent).toContain('Este método no está habilitado');
        expect(document.body.querySelector('[data-testid="comprobante-archivo"]')).toBeNull();
        await cleanup(view);
    });

    it('opens directly on the method of an existing pending proof and shows its evidence', async () => {
        mockOrder.payment_status = 'comprobante_subido';
        mockOrder.payment_proof_method = 'yape';
        mockOrder.payment_proof_url = 'data:image/png;base64,saved-proof';
        const view = await openCollectionDialog();
        expect(document.body.querySelector('[data-testid="caja-comprobante-pendiente"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="caja-comprobante-pendiente"] img')?.getAttribute('src')).toBe(mockOrder.payment_proof_url);
        expect(document.body.querySelector('[data-testid="comprobante-captura"]')).toBeNull();
        await cleanup(view);
    });

    it('reads the proof image on demand when the order list only says it has one', async () => {
        // `GET /orders` no longer carries the base64: the list says `has_proof`, the image comes by id.
        mockOrder.payment_status = 'comprobante_subido';
        mockOrder.payment_proof_method = 'yape';
        mockOrder.has_proof = true;
        const stored = 'data:image/png;base64,fetched-on-demand';
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/payment-config/collection' ? mockCollectionConfig
                : path.startsWith('/orders/') ? { ...mockOrder, payment_proof_url: stored } : null,
        }));
        const view = await openCollectionDialog();
        await flush();
        expect(api.get.mock.calls.some(([path]) => path === '/orders/order-1')).toBe(true);
        expect(document.body.querySelector('[data-testid="caja-comprobante-pendiente"] img')?.getAttribute('src')).toBe(stored);
        await cleanup(view);
    });

    it('does not fetch the order when the list carries no proof', async () => {
        const view = await openCollectionDialog();
        await flush();
        expect(api.get.mock.calls.some(([path]) => path === '/orders/order-1')).toBe(false);
        await cleanup(view);
    });

    it('uploads a photo only to the proof endpoint and leaves the balance unchanged', async () => {
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        await act(async () => document.body.querySelector('[data-testid="caja-enviar-comprobante"]').click());
        await flush();
        expect(api.post).toHaveBeenCalledWith('/payments/order-1/proof', {
            method: 'yape', payment_proof: 'data:image/png;base64,iVBORw0KGgo=',
        }, { timeout: 120000 });
        expect(api.post.mock.calls.some(([path]) => path === '/payments')).toBe(false);
        expect(document.body.textContent).toContain('PagadoS/ 0.00');
        expect(document.body.textContent).toContain('pendiente de verificación');
        expect(api.post.mock.calls.some(([path]) => path === '/payments')).toBe(false);
        await cleanup(view);
    });

    it('retains the selected image and exact request payload after a failed upload', async () => {
        api.post.mockRejectedValueOnce({ response: { data: { detail: 'No se pudo guardar' } } });
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        const upload = document.body.querySelector('[data-testid="caja-enviar-comprobante"]');
        await act(async () => document.body.querySelector('[data-testid="caja-enviar-comprobante"]').click());
        await flush();
        expect(document.body.textContent).toContain('No se pudo guardar');
        expect(document.body.querySelector('[data-testid="comprobante-preview"]')).not.toBeNull();
        await act(async () => upload.click());
        await flush();
        expect(api.post).toHaveBeenCalledTimes(2);
        expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
        await cleanup(view);
    });

    it('clears an unsubmitted photo when the payment method changes', async () => {
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        expect(document.body.querySelector('[data-testid="comprobante-preview"]')).not.toBeNull();
        await selectMethod('plin');
        expect(document.body.querySelector('[data-testid="comprobante-preview"]')).toBeNull();
        await cleanup(view);
    });

    it('pins a submitted proof to its original method and refreshes canonical order before payment', async () => {
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        await act(async () => document.body.querySelector('[data-testid="caja-enviar-comprobante"]').click());
        await flush();
        expect(api.get).toHaveBeenCalledWith('/orders/order-1');
        expect(document.body.textContent).toContain('Comprobante enviado para Yape');
        await selectMethod('plin');
        expect(document.body.textContent).not.toContain('Comprobante enviado para Plin');
        await selectMethod('yape');
        await confirmVerifiedPayment();
        const payment = api.post.mock.calls.find(([path]) => path === '/payments');
        expect(payment[1].expected_updated_at).toBe('fresh-stamp');
        expect(api.post.mock.calls.filter(([path]) => path.endsWith('/proof'))).toHaveLength(1);
        await cleanup(view);
    });

    it('blocks verified payment after proof acceptance until canonical order refresh succeeds', async () => {
        let orderReads = 0;
        api.get.mockImplementation((path) => {
            if (path === '/payment-config/collection') return Promise.resolve({ data: mockCollectionConfig });
            if (path === '/orders/order-1') {
                orderReads += 1;
                return orderReads === 1
                    ? Promise.reject(new Error('temporary read failure'))
                    : Promise.resolve({ data: { ...mockOrder, updated_at: 'fresh-stamp' } });
            }
            return Promise.resolve({ data: null });
        });
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        await act(async () => document.body.querySelector('[data-testid="caja-enviar-comprobante"]').click());
        await flush();
        expect(document.body.textContent).toContain('El comprobante fue recibido');
        expect(document.body.querySelector('[data-testid="caja-cobrar-submit-button"]').disabled).toBe(true);
        expect(api.post.mock.calls.filter(([path]) => path.endsWith('/proof'))).toHaveLength(1);
        await act(async () => document.body.querySelector('[data-testid="caja-recargar-orden"]').click());
        await flush();
        expect(document.body.querySelector('[data-testid="caja-cobrar-submit-button"]').disabled).toBe(false);
        await cleanup(view);
    });

    it('ignores a late upload response after the dialog is reopened for a new interaction', async () => {
        let resolveUpload;
        api.post.mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();
        await act(async () => document.body.querySelector('[data-testid="caja-enviar-comprobante"]').click());
        await flush();
        await act(async () => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Cancelar').click());
        await flush();
        await act(async () => view.host.querySelector('[data-testid="caja-cobrar-17"]').click());
        await flush();
        await act(async () => resolveUpload({ data: { payment_status: 'comprobante_subido' } }));
        await flush();
        expect(document.body.querySelector('[data-testid="caja-comprobante-pendiente"]')).toBeNull();
        expect(api.get.mock.calls.some(([path]) => path === '/orders/order-1')).toBe(false);
        await cleanup(view);
    });

    it('ignores a file read that completes after changing methods', async () => {
        let reader;
        global.FileReader = class {
            constructor() { reader = this; }
            readAsDataURL() { this.result = 'data:image/png;base64,iVBORw0KGgo='; }
        };
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const input = document.body.querySelector('[data-testid="comprobante-archivo"]');
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'proof.png', { type: 'image/png' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await selectMethod('plin');
        await act(async () => reader.onload());
        await flush();
        expect(document.body.querySelector('[data-testid="comprobante-preview"]')).toBeNull();
        await cleanup(view);
    });

    it('keeps explicit verified payments separate from proof upload', async () => {
        api.post.mockResolvedValueOnce({ data: { fully_paid: true, remaining: 0, change_amount: 0 } });
        const view = await openCollectionDialog();
        await selectMethod('yape');
        await confirmVerifiedPayment();
        expect(api.post.mock.calls[0][0]).toBe('/payments');
        expect(api.post.mock.calls.some(([path]) => path.endsWith('/proof'))).toBe(false);
        expect(document.body.querySelector('[data-testid="caja-pago-ok"]')).not.toBeNull();
        await cleanup(view);
    });

    it('hides proof upload when the user has no Cobro function', async () => {
        mockUser.role = 'mozo';
        mockUser.functions = ['atencion'];
        const view = await openCollectionDialog();
        await selectMethod('yape');
        expect(document.body.querySelector('[data-testid="comprobante-captura"]')).toBeNull();
        await cleanup(view);
    });

    it('keeps file attachment available when camera access is unsupported', async () => {
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const camera = document.body.querySelector('[data-testid="comprobante-tomar"]');
        await act(async () => camera.click());
        await flush();
        expect(document.body.textContent).toContain('La cámara no está disponible');
        expect(document.body.querySelector('[data-testid="comprobante-archivo"]')).not.toBeNull();
        await cleanup(view);
    });

    it('stops every acquired camera track when the collection dialog unmounts', async () => {
        const track = { stop: jest.fn() };
        const stream = { getTracks: () => [track] };
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: jest.fn().mockResolvedValue(stream) },
        });
        const view = await openCollectionDialog();
        await selectMethod('yape');
        await act(async () => document.body.querySelector('[data-testid="comprobante-tomar"]').click());
        await flush();
        expect(document.body.querySelector('[data-testid="comprobante-camara"]')).not.toBeNull();
        await cleanup(view);
        expect(track.stop).toHaveBeenCalledTimes(1);
        if (originalDescriptor) Object.defineProperty(navigator, 'mediaDevices', originalDescriptor);
        else delete navigator.mediaDevices;
    });

    it('does not open a second camera stream while the first is active', async () => {
        const track = { stop: jest.fn() };
        const stream = { getTracks: () => [track] };
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
        const getUserMedia = jest.fn().mockResolvedValue(stream);
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
        const view = await openCollectionDialog();
        await selectMethod('yape');
        const cameraButton = document.body.querySelector('[data-testid="comprobante-tomar"]');
        await act(async () => cameraButton.click());
        await flush();
        await act(async () => cameraButton.click());
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        await cleanup(view);
        expect(track.stop).toHaveBeenCalledTimes(1);
        if (originalDescriptor) Object.defineProperty(navigator, 'mediaDevices', originalDescriptor);
        else delete navigator.mediaDevices;
    });

    it('stops a late camera stream when the payment method changes', async () => {
        let resolveStream;
        const track = { stop: jest.fn() };
        const stream = { getTracks: () => [track] };
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: jest.fn(() => new Promise((resolve) => { resolveStream = resolve; })) },
        });
        const view = await openCollectionDialog();
        await selectMethod('yape');
        await act(async () => document.body.querySelector('[data-testid="comprobante-tomar"]').click());
        await selectMethod('plin');
        await act(async () => resolveStream(stream));
        await flush();
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector('[data-testid="comprobante-camara"]')).toBeNull();
        await cleanup(view);
        if (originalDescriptor) Object.defineProperty(navigator, 'mediaDevices', originalDescriptor);
        else delete navigator.mediaDevices;
    });

    it('does not load payment configuration when the user lacks Cobro', async () => {
        mockUser.role = 'mozo';
        mockUser.functions = ['atencion'];
        const view = await openCollectionDialog();
        await selectMethod('yape');
        expect(api.get).not.toHaveBeenCalledWith('/payment-config/collection');
        expect(document.body.querySelector('[data-testid="comprobante-captura"]')).toBeNull();
        await cleanup(view);
    });
});
