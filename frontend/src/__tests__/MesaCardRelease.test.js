import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MesaCard from '@/components/MesaCard';

global.IS_REACT_ACT_ENVIRONMENT = true;

const item = (changes = {}) => ({
    table: { id: 't1', number: 4, status: 'ocupada', capacity: 4, active_attention_id: 'a1' },
    floor: { key: 'entregado' },
    displayOrder: { id: 'o1', status: 'entregado', total: 25, amount_paid: 0, items: [{ status: 'listo' }] },
    serviceOrder: { id: 'o1', status: 'entregado', total: 25, amount_paid: 0, items: [{ status: 'listo' }], attention_state: 'open' },
    ready: 0,
    due: 25,
    billRequested: false,
    showVisitaActiva: false,
    group: null,
    groupBadge: null,
    groupNumbers: null,
    visitOrders: [],
    ...changes,
});

const render = async (props) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(
        <MesaCard canTake canServe canCharge canClose={false} {...props} />,
    ));
    return { host, root };
};

describe('MesaCard en modo «solo pedidos»', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('ofrece «Liberar mesa» sin validar el pago', async () => {
        const onRelease = jest.fn();
        const { host, root } = await render({
            item: item(),
            requirePayment: false,
            onRelease,
        });

        const button = host.querySelector('[data-testid="mesa-card-liberar-4"]');
        expect(button).not.toBeNull();
        expect(button.textContent).toBe('Liberar mesa');
        await act(async () => button.click());
        expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
        await act(async () => root.unmount());
    });

    it('con el control de pagos encendido no ofrece esa salida', async () => {
        const { host, root } = await render({ item: item(), requirePayment: true });

        expect(host.querySelector('[data-testid="mesa-card-liberar-4"]')).toBeNull();
        expect(host.querySelector('[data-testid="servicio-cerrar-4"]')).toBeNull();
        await act(async () => root.unmount());
    });
});
