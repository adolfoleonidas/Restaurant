import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SalonAlerts from '@/pages/salon/SalonAlerts';

global.IS_REACT_ACT_ENVIRONMENT = true;

const props = {
    branchCatalog: { error: false }, isOwner: false, navigate: jest.fn(), ordersError: null,
    refetchOrders: jest.fn(), refetchTables: jest.fn(), scope: null, tablesError: null, unassignedCount: 0,
};

async function alertText(overrides) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SalonAlerts {...props} {...overrides} />));
    const node = host.querySelector('[role="alert"]');
    const text = node ? node.textContent : null;
    await act(async () => root.unmount());
    host.remove();
    return text;
}

describe('Salón load failure banner', () => {
    it('shows the server detail of a 403 so staff know what to ask for', async () => {
        const error = { response: { status: 403, data: { detail: 'El usuario no tiene una sucursal asignada' } } };
        const text = await alertText({ tablesError: error });
        expect(text).toContain('El usuario no tiene una sucursal asignada');
    });

    it('keeps the generic message for errors without a detail', async () => {
        const text = await alertText({ ordersError: new Error('Network Error') });
        expect(text).toContain('No se pudo actualizar el salón');
    });
});
