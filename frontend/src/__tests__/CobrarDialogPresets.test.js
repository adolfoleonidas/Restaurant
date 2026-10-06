/**
 * Presets de efectivo dinámicos del CobrarDialog (Slice 4, S4-3).
 *
 * Regla del prototipo: únicos de [total, redondeo a 10, a 50, 100, 200]
 * filtrando >= total, máximo 4. El botón "Exacto" se mantiene porque el e2e
 * móvil lo usa.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CobrarDialog from '@/components/CobrarDialog';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'cashier-1', role: 'cajero' } }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const order = (total, extra = {}) => ({
    id: 'order-1', order_number: 17, status: 'pendiente_pago', payment_status: 'pendiente',
    subtotal: total, total, amount_paid: 0, updated_at: 'stamp',
    items: [{ id: 'i1', product_name: 'Lomo', quantity: 1, unit_price: total, subtotal: total, paid_qty: 0 }],
    ...extra,
});

async function mountDialog(acct) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<CobrarDialog open onOpenChange={() => {}} order={acct} onPaid={() => {}} />));
    return { host, root };
}

const preset = (index) => document.body.querySelector(`[data-testid="caja-preset-${index}"]`);

describe('CobrarDialog · presets de efectivo (S4-3)', () => {
    let host;
    let root;

    beforeEach(() => {
        api.get.mockReset().mockImplementation(() => Promise.resolve({ data: {} }));
        api.post.mockReset().mockResolvedValue({ data: {} });
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
    });

    it('arma el efectivo justo y redondeos, sin pasar de 4', async () => {
        ({ host, root } = await mountDialog(order(38)));

        expect(document.body.querySelector('[data-testid="caja-preset-exacto"]')).not.toBeNull();
        expect(preset(0).textContent).toContain('S/ 38.00');
        expect(preset(1).textContent).toContain('S/ 40.00');
        expect(preset(2).textContent).toContain('S/ 50.00');
        expect(preset(3).textContent).toContain('S/ 100.00');
        // El quinto (200) queda fuera del máximo de 4.
        expect(preset(4)).toBeNull();
    });

    it('deduplica y descarta los presets menores al total', async () => {
        ({ host, root } = await mountDialog(order(120)));

        expect(preset(0).textContent).toContain('S/ 120.00');
        expect(preset(1).textContent).toContain('S/ 150.00');
        expect(preset(2).textContent).toContain('S/ 200.00');
        expect(preset(3)).toBeNull();
    });

    it('calcula sobre lo pendiente, no sobre el total de la cuenta', async () => {
        ({ host, root } = await mountDialog(order(100, { amount_paid: 40 })));

        expect(preset(0).textContent).toContain('S/ 60.00');
        expect(preset(1).textContent).toContain('S/ 100.00');
    });

    it('tocar un preset completa el efectivo recibido y Exacto usa el pendiente', async () => {
        ({ host, root } = await mountDialog(order(38)));

        await act(async () => preset(1).dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(document.body.querySelector('[data-testid="caja-recibido-input"]').value).toBe('40.00');

        await act(async () => document.body.querySelector('[data-testid="caja-preset-exacto"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(document.body.querySelector('[data-testid="caja-recibido-input"]').value).toBe('38.00');
    });
});
