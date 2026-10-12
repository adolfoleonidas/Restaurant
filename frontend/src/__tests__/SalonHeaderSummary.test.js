import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SalonHeader from '@/pages/salon/SalonHeader';

global.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
    branchCatalog: { branches: [], loading: false }, canTake: false, chooseScope: jest.fn(), isOwner: false,
    navigate: jest.fn(), openAreas: jest.fn(), scope: null, search: '', searchRef: { current: null },
    selectMode: false, setSearch: jest.fn(), startSelection: jest.fn(),
};

async function summaryText(summary) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<SalonHeader {...baseProps} summary={summary} />));
    const text = host.querySelector('[data-testid="salon-resumen"]').textContent;
    await act(async () => root.unmount());
    host.remove();
    return text;
}

describe('Salón header summary', () => {
    it('names the unit of each count and agrees in number', async () => {
        expect(await summaryText({ toPrep: 3, toReady: 1, toPay: 2 })).toBe('En cocina: 3 platos · Listos: 1 plato · Por cobrar: 2 mesas');
        expect(await summaryText({ toPrep: 1, toReady: 0, toPay: 1 })).toBe('En cocina: 1 plato · Listos: 0 platos · Por cobrar: 1 mesa');
    });
});

describe('Salón filter chips', () => {
    it('say that they count tables', async () => {
        const FloorFilters = require('@/pages/salon/FloorFilters').default;
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => root.render(
            <FloorFilters areaFilter="todas" areaLabel={(a) => a} areas={['todas']} setAreaFilter={jest.fn()}
                setStateFilter={jest.fn()} stateFilter="todas" stateCounts={{ todas: 4, libre: 1, activas: 0, listo: 2, cuenta: 1 }} />,
        ));
        expect(host.querySelector('[data-testid="salon-filtro-cuenta"]').getAttribute('title')).toBe('1 mesa');
        expect(host.querySelector('[data-testid="salon-filtro-listo"]').getAttribute('title')).toBe('2 mesas');
        await act(async () => root.unmount());
        host.remove();
    });
});
