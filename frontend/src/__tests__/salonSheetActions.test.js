import { buildMoreActions } from '@/pages/salon/sheetActions';

const handlers = () => ({
    closeSheet: jest.fn(),
    navigate: jest.fn(),
    takeOrderInline: jest.fn(),
    deliver: jest.fn(),
    closeAttention: jest.fn(),
    requestBill: jest.fn(),
    setSummaryOpen: jest.fn(),
    splitAccount: jest.fn(),
    openTransfer: jest.fn(),
    setMoveAccountId: jest.fn(),
    mergeAccounts: jest.fn(),
    releaseTable: jest.fn(),
});

const base = (extra = {}) => ({
    t: { id: 't1', number: 4, status: 'ocupada' },
    order: { id: 'o1', items: [] },
    accountTable: null,
    accounts: [{ id: 'o1' }],
    hasAccount: true,
    floor: { key: 'preparando' },
    actionOrder: { id: 'o1', status: 'en_preparacion', items: [{ status: 'pendiente' }] },
    actionAccountId: 'o1',
    closeable: false,
    billRequested: false,
    closing: null,
    canTake: true,
    canServe: true,
    ...handlers(),
    ...extra,
});

const keys = (actions) => actions.map((a) => a.key || a.group);

describe('buildMoreActions', () => {
    test('a table following a group account offers to open it and to order apart', () => {
        const ctx = base({ accountTable: { number: 2 }, order: { id: 'o7' } });
        const actions = buildMoreActions(ctx);
        expect(keys(actions)).toEqual(['ver-pedido-grupo', 'pedir-grupo']);
        expect(actions[0].label).toBe('Ver pedido de Mesa 2');
        expect(actions[1].label).toBe('Pedir para Mesa 4 (cuenta aparte)');
        actions[0].onSelect();
        expect(ctx.closeSheet).toHaveBeenCalled();
        expect(ctx.navigate).toHaveBeenCalledWith('/pedidos/o7');
        actions[1].onSelect();
        expect(ctx.takeOrderInline).toHaveBeenCalledWith(ctx.t);
        expect(keys(buildMoreActions(base({ accountTable: { number: 2 }, order: { id: 'o7' }, canTake: false })))).toEqual(['ver-pedido-grupo']);
    });

    test('with an account the base menu opens the order and the table summary', () => {
        const ctx = base();
        const actions = buildMoreActions(ctx);
        expect(keys(actions)).toEqual(['ver-pedido', 'resumen-recibo', 'mover-pedido']);
        expect(actions[0]).toMatchObject({ label: 'Abrir pedido', testId: 'mesa-sheet-ver-pedido', disabled: false });
        actions[0].onSelect();
        expect(ctx.navigate).toHaveBeenCalledWith('/pedidos/o1');
        actions[1].onSelect();
        expect(ctx.setSummaryOpen).toHaveBeenCalledWith(true);
        actions[2].onSelect();
        expect(ctx.openTransfer).toHaveBeenCalledWith(ctx.t);
        expect(buildMoreActions(base({ actionAccountId: null }))[0].disabled).toBe(true);
    });

    test('a ready table says "Ver pedido" and offers to deliver to those who serve', () => {
        const ctx = base({ floor: { key: 'listo' } });
        const actions = buildMoreActions(ctx);
        expect(actions[0].label).toBe('Ver pedido');
        expect(keys(actions)).toContain('entregar');
        actions.find((a) => a.key === 'entregar').onSelect();
        expect(ctx.deliver).toHaveBeenCalledWith('o1');
        expect(keys(buildMoreActions(base({ floor: { key: 'listo' }, canServe: false })))).not.toContain('entregar');
    });

    test('finishing the table is offered when closeable and shows progress while closing', () => {
        const ctx = base({ closeable: true });
        const close = buildMoreActions(ctx).find((a) => a.key === 'cerrar');
        expect(close).toMatchObject({ label: 'Finalizar mesa', testId: 'servicio-cerrar-sheet-4', disabled: false });
        close.onSelect();
        expect(ctx.closeAttention).toHaveBeenCalledWith(ctx.actionOrder);
        const busy = buildMoreActions(base({ closeable: true, closing: 'o1' })).find((a) => a.key === 'cerrar');
        expect(busy).toMatchObject({ label: 'Cerrando…', disabled: true });
    });

    test('asking for the bill needs a served order that is not closeable nor already requested', () => {
        const served = { id: 'o1', status: 'entregado', items: [] };
        const ctx = base({ actionOrder: served });
        const ask = buildMoreActions(ctx).find((a) => a.key === 'solicitar-cuenta');
        expect(ask.label).toBe('Solicitar cuenta');
        ask.onSelect();
        expect(ctx.requestBill).toHaveBeenCalledWith(served);
        expect(keys(buildMoreActions(base({ actionOrder: served, closeable: true })))).not.toContain('solicitar-cuenta');
        expect(keys(buildMoreActions(base({ actionOrder: served, billRequested: true })))).not.toContain('solicitar-cuenta');
        expect(keys(buildMoreActions(base({ actionOrder: served, canTake: false })))).not.toContain('solicitar-cuenta');
        expect(keys(buildMoreActions(base({ actionOrder: { ...served, status: 'en_preparacion' } })))).not.toContain('solicitar-cuenta');
    });

    test('splitting the bill needs two billable lines and offers two, three or four parts', () => {
        const lines = [{ status: 'pendiente' }, { status: 'cancelado' }, { status: 'cancelado' }];
        const ctx = base({ actionOrder: { id: 'o1', status: 'en_preparacion', items: lines } });
        expect(keys(buildMoreActions(ctx))).not.toContain('Dividir la cuenta');
        const two = [{ status: 'pendiente' }, { status: 'listo' }];
        const split = buildMoreActions(base({ actionOrder: { id: 'o1', status: 'en_preparacion', items: two } }));
        expect(keys(split).filter((k) => k !== 'ver-pedido')).toEqual([
            'resumen-recibo', 'Dividir la cuenta', 'dividir-2', 'dividir-3', 'dividir-4', 'mover-pedido',
        ]);
        const ctx2 = base({ actionOrder: { id: 'o1', status: 'en_preparacion', items: two } });
        buildMoreActions(ctx2).find((a) => a.key === 'dividir-3').onSelect();
        expect(ctx2.splitAccount).toHaveBeenCalledWith(3);
    });

    test('several accounts add moving this account and merging them', () => {
        const ctx = base({ accounts: [{ id: 'o1' }, { id: 'o2' }] });
        const actions = buildMoreActions(ctx);
        expect(keys(actions).slice(-2)).toEqual(['mover-cuenta', 'fusionar-cuentas']);
        actions.find((a) => a.key === 'mover-cuenta').onSelect();
        expect(ctx.setMoveAccountId).toHaveBeenCalledWith('o1');
        actions.find((a) => a.key === 'fusionar-cuentas').onSelect();
        expect(ctx.mergeAccounts).toHaveBeenCalled();
        expect(keys(buildMoreActions(base({ accounts: [{ id: 'o1' }, { id: 'o2' }], canTake: false })))).not.toContain('mover-cuenta');
    });

    test('a paid table without account only offers to release it', () => {
        const ctx = base({ hasAccount: false, order: null, t: { id: 't1', number: 4, status: 'pagada' } });
        const actions = buildMoreActions(ctx);
        expect(keys(actions)).toEqual(['liberar']);
        expect(actions[0]).toMatchObject({ label: 'Liberar mesa', testId: 'mesa-sheet-liberar', disabled: false });
        actions[0].onSelect();
        expect(ctx.releaseTable).toHaveBeenCalledWith(ctx.t);
        expect(buildMoreActions(base({ hasAccount: false, order: null, canTake: false, t: { id: 't1', number: 4, status: 'pagada' } }))[0].disabled).toBe(true);
    });

    test('sin control de pagos la salida es "Liberar mesa", no "Finalizar mesa"', () => {
        const ctx = base({ requirePayment: false });
        const actions = buildMoreActions(ctx);
        expect(keys(actions)).not.toContain('cerrar');
        expect(keys(actions)).not.toContain('solicitar-cuenta');
        const release = actions.find((a) => a.key === 'liberar-sin-cobro');
        expect(release).toMatchObject({ label: 'Liberar mesa', testId: 'mesa-sheet-liberar', disabled: false });
        release.onSelect();
        expect(ctx.releaseTable).toHaveBeenCalledWith(ctx.t);
        // En modo con cobro, la acción no existe (solo la mesa pagada la ofrece).
        expect(keys(buildMoreActions(base()))).not.toContain('liberar-sin-cobro');
        // Una mesa sentada sin pedido también se puede liberar en este modo.
        expect(keys(buildMoreActions(base({
            hasAccount: false, order: null, requirePayment: false,
            t: { id: 't1', number: 4, status: 'ocupada' },
        })))).toEqual(['liberar']);
    });

    test('a free table without account has no extra actions', () => {
        expect(buildMoreActions(base({ hasAccount: false, order: null, t: { id: 't1', number: 4, status: 'disponible' } }))).toEqual([]);
    });
});
