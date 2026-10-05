import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Comprobantes from '@/pages/Comprobantes';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const pendingProof = {
    id: 'order-1', order_number: 12, payment_status: 'comprobante_subido',
    payment_proof_method: 'yape', payment_proof_uploaded_at: '2026-10-04T11:00:00Z',
    payment_proof_uploaded_by_name: 'Cajero Test', total: 25, amount_paid: 0,
    table: { id: 't1', number: 7 }, created_at: '2026-10-04T10:00:00Z', source: 'staff',
};
const settledProof = {
    id: 'order-2', order_number: 13, payment_status: 'pagado',
    payment_proof_method: 'plin', payment_proof_uploaded_at: '2026-10-04T09:00:00Z',
    total: 40, amount_paid: 40, source: 'staff',
};

jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: () => ({ data: { pending: 1, items: [pendingProof, settledProof] }, refetch: jest.fn() }),
}));
jest.mock('@/hooks/useBranchNames', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1', restaurant_id: 'r1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

describe('Comprobantes review', () => {
    let host; let root;

    beforeEach(() => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/orders/order-1'
                ? { ...pendingProof, payment_proof_url: 'data:image/png;base64,PROOF' }
                : [],
        }));
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
    });

    it('lists captured proofs and summarises the pending ones', async () => {
        await act(async () => root.render(<Comprobantes />));
        expect(host.querySelector('[data-testid="comprobantes-row-12"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="comprobantes-row-13"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="comprobantes-resumen"]').textContent).toContain('1 pendiente');
        expect(host.textContent).toContain('Pendiente de revisión');
        expect(host.textContent).toContain('Mesa 7');
        expect(api.get).not.toHaveBeenCalledWith('/orders/order-1');
    });

    it('opens on "Todos" and lists "Todos" first', async () => {
        await act(async () => root.render(<Comprobantes />));
        const filters = [...host.querySelectorAll('[data-testid^="comprobantes-filtro-"]')];
        expect(filters.map((el) => el.getAttribute('data-testid'))).toEqual([
            'comprobantes-filtro-all',
            'comprobantes-filtro-pending',
        ]);
        expect(host.querySelector('[data-testid="comprobantes-filtro-all"]').textContent).toBe('Todos');
    });

    it('loads the proof image on demand instead of shipping it with the list', async () => {
        await act(async () => root.render(<Comprobantes />));
        const button = host.querySelector('[data-testid="comprobantes-ver-12"]');
        await act(async () => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(api.get).toHaveBeenCalledWith('/orders/order-1');
        const image = document.body.querySelector('[data-testid="comprobantes-imagen"]');
        expect(image).not.toBeNull();
        expect(image.getAttribute('src')).toBe('data:image/png;base64,PROOF');
    });
});
