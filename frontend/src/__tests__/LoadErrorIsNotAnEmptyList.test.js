/**
 * Un fallo de red no puede parecer «no hay nada».
 *
 * Tres pantallas de trabajo convertían el error en una lista vacía, así que la
 * pantalla afirmaba algo falso: la cola de prepagos por verificar desaparecía
 * entera (dinero esperando), el arqueo de caja mostraba KPI en cero, y el menú
 * decía «Todavía no hay plantillas». En las tres, un error visible es más seguro
 * que una lista vacía creíble.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import PrepayQueue from '@/pages/caja/PrepayQueue';
import CashHistory from '@/pages/caja/CashHistory';
import GestionarMenu from '@/pages/menu/GestionarMenu';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/payments', () => ({ listPendingPrepay: jest.fn(), runPrepayAction: jest.fn() }));
jest.mock('@/lib/api/cash', () => ({ listCashHistory: jest.fn() }));
jest.mock('@/lib/api/menu', () => ({
    getMenuDay: jest.fn(),
    saveMenuDay: jest.fn(),
    setMenuSoldOut: jest.fn(),
    copyMenuFrom: jest.fn(),
    listMenuTemplates: jest.fn(),
    saveMenuTemplate: jest.fn(),
    deleteMenuTemplate: jest.fn(),
    applyMenuTemplate: jest.fn(),
    repeatMenuTemplate: jest.fn(),
}));
jest.mock('@/lib/api/products', () => ({ updateProduct: jest.fn() }));
jest.mock('@/hooks/useOrderProof', () => ({
    __esModule: true,
    default: () => ({ proof: null, openProof: jest.fn(), closeProof: jest.fn() }),
}));
jest.mock('@/components/ProofPreview', () => ({ __esModule: true, default: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { listPendingPrepay } = require('@/lib/api/payments');
const { listCashHistory } = require('@/lib/api/cash');
const { getMenuDay, listMenuTemplates } = require('@/lib/api/menu');

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
});

async function mount(element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(element); });
    await flush();
    return { host, root };
}

const NETWORK_ERROR = { response: { status: 500, data: {} } };
// Estable entre renders: un objeto literal nuevo haría que el efecto se vuelva a
// disparar en cada render y la prueba se quedaría en bucle.
const NO_SCOPE = {};

afterEach(() => { document.body.innerHTML = ''; jest.clearAllMocks(); });

describe('fallos de carga que antes se disfrazaban de lista vacía', () => {
    it('la cola de prepagos avisa en vez de desaparecer', async () => {
        listPendingPrepay.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<PrepayQueue runMutation={(fn) => fn()} />);

        expect(host.querySelector('[data-testid="caja-prepagos-error"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="caja-prepagos-reintentar"]')).not.toBeNull();

        const callsBefore = listPendingPrepay.mock.calls.length;
        await act(async () => host.querySelector('[data-testid="caja-prepagos-reintentar"]').click());
        await flush();
        expect(listPendingPrepay.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('una cola de prepagos realmente vacía sigue sin mostrar nada', async () => {
        listPendingPrepay.mockResolvedValue({ data: [] });
        const { host } = await mount(<PrepayQueue runMutation={(fn) => fn()} />);

        expect(host.querySelector('[data-testid="caja-prepagos-error"]')).toBeNull();
        expect(host.querySelector('[data-testid="caja-prepagos"]')).toBeNull();
    });

    it('el arqueo de caja avisa en vez de mostrar KPI en cero', async () => {
        listCashHistory.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<CashHistory refreshKey={0} scopeParams={NO_SCOPE} />);

        expect(host.querySelector('[data-testid="caja-historial-error"]')).not.toBeNull();
        // Los KPI no pueden salir en cero: no hay datos, no es que sean cero.
        expect(host.textContent).not.toContain('No hay turnos en este período');
    });

    it('un arqueo realmente vacío sí dice que no hay turnos', async () => {
        listCashHistory.mockResolvedValue({ data: { registers: [], sessions: 0, total_sales: 0, difference: 0 } });
        const { host } = await mount(<CashHistory refreshKey={0} scopeParams={NO_SCOPE} />);

        expect(host.querySelector('[data-testid="caja-historial-error"]')).toBeNull();
        expect(host.textContent).toContain('No hay turnos en este período');
    });

    it('el menú avisa en vez de decir que no hay plantillas', async () => {
        getMenuDay.mockResolvedValue({ data: { date: '2026-03-10', status: 'draft', published: false, has_menu: true, selection: [], catalog: [] } });
        listMenuTemplates.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<GestionarMenu />);

        await act(async () => host.querySelector('[data-testid="menu-tab-week"]').click());
        await flush();

        expect(host.querySelector('[data-testid="menu-plantillas-error"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="menu-plantillas-vacio"]')).toBeNull();
    });
});
