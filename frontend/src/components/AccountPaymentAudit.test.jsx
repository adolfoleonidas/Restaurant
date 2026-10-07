import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AccountPaymentAudit from '@/components/AccountPaymentAudit';
import Caja from '@/pages/Caja';
import { api } from '@/lib/api';

let mockUser;
let mockOrders;
const register = { id: 'register-1', status: 'open', opening_amount: 100, expected_amount: 100,
    opened_by_name: 'Caja', opened_at: '2026-10-04T10:00:00Z', movements: [], by_method: {} };

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...p }) => <a href={to} {...p}>{children}</a>,
    useSearchParams: () => [new URLSearchParams()],
}));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const source = fetcher.toString();
        if (source.includes("scopedGet('/cash/current')")) return { data: register, refetch: jest.fn() };
        if (source.includes("scopedGet('/orders'")) return { data: mockOrders, refetch: jest.fn() };
        if (source.includes("scopedGet('/tables')")) return { data: [], refetch: jest.fn() };
        return { data: null, refetch: jest.fn() };
    },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const order = (overrides = {}) => ({
    id: 'order-1', order_number: 17, total: 30, amount_paid: 12, payment_status: 'parcial',
    payment_proof_url: 'data:image/png;base64,SECRET_IMAGE_DATA', payment_proof_method: 'yape',
    payment_proof_uploaded_at: '2026-10-04T11:00:00Z', ...overrides,
});
const payment = (overrides = {}) => ({
    id: 'payment-1', order_id: 'order-1', amount: 12, status: 'completed', method: 'efectivo',
    created_at: '2026-10-04T10:30:00Z', paid_by: 'private-user-id', ...overrides,
});

let views;
function mount(element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    views.push({ host, root });
    act(() => root.render(element));
    return { host, root };
}
async function settle() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
async function click(element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function auditDialogText() {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    return dialogs[dialogs.length - 1]?.textContent || '';
}
async function unmount(view) {
    await act(async () => view.root.unmount());
    view.host.remove();
    views = views.filter((item) => item !== view);
}
beforeEach(() => {
    views = [];
    mockUser = { id: 'cashier-1', role: 'cajero', functions: ['cobro'] };
    mockOrders = [];
    api.get.mockReset();
    api.post.mockReset();
});
afterEach(async () => {
    for (const { host, root } of views) {
        await act(async () => root.unmount());
        host.remove();
    }
    document.body.innerHTML = '';
});

test('shows balance, completed payment history, reversals and proof metadata without rendering proof or actors', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order() : [
        payment(), payment({ id: 'payment-2', amount: 4, status: 'refunded', method: 'yape', void_kind: 'refund',
            void_reason: 'Duplicate test charge', voided_at: '2026-10-04T12:00:00Z' }),
    ] }));
    const { host } = mount(<AccountPaymentAudit order={order()} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(api.get.mock.calls.map(([path]) => path).sort()).toEqual(['/orders/order-1', '/payments/by-order/order-1']);
    expect(auditDialogText()).toContain('S/');
    expect(auditDialogText()).toContain('Comprobante');
    expect(auditDialogText()).toContain('Yape');
    expect(auditDialogText()).toContain('Duplicate test charge');
    expect(auditDialogText()).not.toContain('SECRET_IMAGE_DATA');
    expect(auditDialogText()).not.toContain('private-user-id');
    expect(host.querySelector('img')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
});

test('accepts authentic unpaid and cash-paid orders with only fields the backend persists', async () => {
    const unpaid = order({ amount_paid: 0, payment_status: 'pendiente', payment_proof_url: null,
        payment_proof_method: null, payment_proof_uploaded_at: null });
    delete unpaid.amount_paid;
    delete unpaid.payment_status;
    delete unpaid.payment_proof_url;
    delete unpaid.payment_proof_method;
    delete unpaid.payment_proof_uploaded_at;
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? unpaid : [] }));
    const empty = mount(<AccountPaymentAudit order={unpaid} />);
    await click(empty.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no hay pagos/i);
    await unmount(empty);

    const cashPaid = order({ payment_status: 'parcial', payment_proof_url: null,
        payment_proof_method: null, payment_proof_uploaded_at: null });
    delete cashPaid.payment_proof_url;
    delete cashPaid.payment_proof_method;
    delete cashPaid.payment_proof_uploaded_at;
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? cashPaid : [
        payment({ id: 'cash-payment-1' }),
    ] }));
    const paid = mount(<AccountPaymentAudit order={cashPaid} />);
    await click(paid.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/pagos completados consultados/i);
});

test('does not call a confirmed order with zero paid balance and no proof an empty verified ledger', async () => {
    const confirmed = order({ amount_paid: 0, payment_status: 'confirmado', payment_proof_url: null,
        payment_proof_method: null, payment_proof_uploaded_at: null });
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? confirmed : [] }));
    const { host } = mount(<AccountPaymentAudit order={confirmed} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se puede verificar|no permite verificar/i);
    expect(auditDialogText()).not.toMatch(/no hay pagos registrados ni comprobante disponible/i);
});

test('shows the completed-entry count and rejects missing or duplicate payment IDs', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order({ amount_paid: 24 }) : [
        payment({ id: 'completed-1' }), payment({ id: 'completed-2' }),
    ] }));
    const completed = mount(<AccountPaymentAudit order={order({ amount_paid: 24 })} />);
    await click(completed.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/pagos completados/i);
    expect(auditDialogText()).toMatch(/Pagos completados\s*2/i);
    expect(auditDialogText()).not.toContain('completed-1');
    await unmount(completed);

    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order() : [
        payment({ id: 'duplicate-reversal', status: 'refunded', amount: 4 }),
        payment({ id: 'duplicate-reversal', status: 'refunded', amount: 4 }),
    ] }));
    const duplicate = mount(<AccountPaymentAudit order={order()} />);
    await click(duplicate.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se puede verificar|datos ausentes/i);
    expect(auditDialogText()).not.toMatch(/Registros \(0\)|No hay registros de pago/i);
    await unmount(duplicate);
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order() : [
        payment({ id: undefined }),
    ] }));
    const missingId = mount(<AccountPaymentAudit order={order()} />);
    await click(missingId.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se puede verificar|datos ausentes/i);
    expect(auditDialogText()).not.toMatch(/Registros \(0\)|No hay registros de pago/i);
});
test('marks the endpoint cap as incomplete rather than claiming an empty or complete ledger', async () => {
    const rows = Array.from({ length: 50 }, (_, index) => payment({ status: 'refunded', amount: 1, id: `p-${index}` }));
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order({ amount_paid: 0, payment_status: 'pendiente', payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null }) : rows }));
    const { host } = mount(<AccountPaymentAudit order={order({ amount_paid: 0, payment_status: 'pendiente', payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null })} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/50|límite/i);
    expect(auditDialogText()).toMatch(/incomplet|no se puede confirmar/i);
});

test('distinguishes a genuinely empty history from request failure, malformed responses and mismatched totals', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order({ amount_paid: 0, payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null, payment_status: 'pendiente' }) : [] }));
    const empty = mount(<AccountPaymentAudit order={order({ amount_paid: 0, payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null, payment_status: 'pendiente' })} />);
    await click(empty.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no hay pagos/i);
    expect(auditDialogText()).toMatch(/comprobante disponible/i);

    api.get.mockRejectedValue(new Error('forbidden'));
    const failed = mount(<AccountPaymentAudit order={order()} />);
    await click(failed.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se pudo verificar/i);
});

test('rejects malformed and inconsistent API data as unverified', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order() : { rows: [] } }));
    const { host } = mount(<AccountPaymentAudit order={order()} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se puede verificar|datos ausentes/i);

    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1' ? order() : [payment({ amount: 8 })] }));
    const mismatch = mount(<AccountPaymentAudit order={order()} />);
    await click(mismatch.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no coincide|inconsistente|no se pudo verificar/i);
});


test('rejects recognized order status that contradicts its recorded paid balance', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1'
        ? order({ amount_paid: 0, payment_status: 'pagado', payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null })
        : [] }));
    const { host } = mount(<AccountPaymentAudit order={order({ amount_paid: 0, payment_status: 'pagado', payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null })} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se pudo verificar|inconsistente/i);
});
test('treats unknown payment/proof status and missing proof fields as unverified', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1'
        ? order({ payment_status: 'future_status' }) : [payment({ status: 'future_status' })] }));
    const { host } = mount(<AccountPaymentAudit order={order()} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se pudo verificar|no reconocidos/i);

    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders/order-1'
        ? { ...order(), payment_proof_url: undefined } : [] }));
    const missing = mount(<AccountPaymentAudit order={order()} />);
    await click(missing.host.querySelector('[data-testid="caja-audit-order-17"]'));
    await settle();
    expect(auditDialogText()).toMatch(/no se puede verificar|datos ausentes/i);
});

test('keeps late results for a previous selected account from appearing for the next account', async () => {
    const requests = [];
    api.get.mockImplementation((path) => new Promise((resolve) => requests.push({ path, resolve })));
    const first = order({ id: 'first', order_number: 1 });
    const second = order({ id: 'second', order_number: 2, amount_paid: 0, payment_status: 'pendiente', payment_proof_url: null, payment_proof_method: null, payment_proof_uploaded_at: null });
    const { host, root } = mount(<AccountPaymentAudit order={first} />);
    await click(host.querySelector('[data-testid="caja-audit-order-1"]'));
    await act(async () => root.render(<AccountPaymentAudit order={second} />));
    await settle();
    requests.filter((request) => request.path.includes('first')).forEach((request) => request.resolve({ data: order({ id: 'first' }) }));
    requests.filter((request) => request.path.includes('/orders/second')).forEach((request) => request.resolve({ data: second }));
    requests.filter((request) => request.path.includes('/payments/by-order/second')).forEach((request) => request.resolve({ data: [] }));
    await settle();
    expect(auditDialogText()).not.toContain('Pedido #1');
    expect(auditDialogText()).toContain('No hay pagos');
});


test('does not apply a late response after the audit dialog closes while loading', async () => {
    const requests = [];
    api.get.mockImplementation((path) => new Promise((resolve) => requests.push({ path, resolve })));
    const { host } = mount(<AccountPaymentAudit order={order()} />);
    await click(host.querySelector('[data-testid="caja-audit-order-17"]'));
    const close = Array.from(document.body.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Cerrar');
    await click(close);
    requests.forEach((request) => request.resolve({ data: request.path === '/orders/order-1' ? order() : [] }));
    await settle();
    expect(auditDialogText()).not.toContain('Los totales de la cuenta coinciden');
});

test('provides the read-only audit action on both Caja account lists, including a paid card', async () => {
    mockOrders = [
        { id: 'unpaid', order_number: 21, status: 'pendiente_pago', payment_status: 'pendiente', total: 8, items: [] },
        { id: 'paid', order_number: 22, status: 'enviado_cocina', payment_status: 'pagado', total: 45, items: [] },
    ];
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/orders' ? mockOrders : path === '/tables' ? [] : path === '/cash/current' ? register : [] }));
    const { host } = mount(<Caja />);
    await settle();
    expect(host.querySelector('[data-testid="caja-audit-order-21"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="caja-audit-order-22"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="caja-cobrar-22"]')).toBeNull();
});
