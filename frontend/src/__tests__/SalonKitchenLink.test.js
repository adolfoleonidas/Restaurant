import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SalonHeader from '@/pages/salon/SalonHeader';
import { canAccessRoute } from '@/lib/permissions';

global.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
    branchCatalog: { branches: [], loading: false }, canTake: false, chooseScope: jest.fn(), isOwner: false,
    navigate: jest.fn(), openAreas: jest.fn(), scope: null, search: '', searchRef: { current: null },
    selectMode: false, setSearch: jest.fn(), startSelection: jest.fn(), floorDue: 0,
    summary: { toPrep: 3, toReady: 0, toPay: 0 },
};

async function kitchenButton(props) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SalonHeader {...baseProps} {...props} />));
    const button = host.querySelector('[data-testid="salon-ir-cocina"]');
    const label = button ? button.textContent : null;
    await act(async () => root.unmount());
    host.remove();
    return label;
}

describe('Salón kitchen shortcut', () => {
    it('is shown only to roles the /cocina guard admits', async () => {
        expect(await kitchenButton({ canGoKitchen: true })).toBe('Cocina (3)');
        expect(await kitchenButton({ canGoKitchen: false })).toBeNull();
    });

    it('is hidden when nothing is in the kitchen', async () => {
        expect(await kitchenButton({ canGoKitchen: true, summary: { toPrep: 0, toReady: 0, toPay: 0 } })).toBeNull();
    });

    it('follows the route guard: admin and mozo yes, cajero no', () => {
        expect(canAccessRoute({ role: 'admin' }, '/cocina')).toBe(true);
        expect(canAccessRoute({ role: 'mozo' }, '/cocina')).toBe(true);
        expect(canAccessRoute({ role: 'cajero' }, '/cocina')).toBe(false);
    });
});
