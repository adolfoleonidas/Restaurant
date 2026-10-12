import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PrepayQueue from '@/pages/caja/PrepayQueue';
import { listPendingPrepay, runPrepayAction } from '@/lib/api/payments';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/payments', () => ({ listPendingPrepay: jest.fn(), runPrepayAction: jest.fn() }));
jest.mock('@/hooks/useOrderProof', () => ({ __esModule: true, default: () => ({ proof: null, openProof: jest.fn(), closeProof: jest.fn() }) }));
jest.mock('@/components/ProofPreview', () => ({ __esModule: true, default: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const q = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const click = async (id) => { await act(async () => q(id).click()); await flush(); };

describe('rejecting a prepayment', () => {
    let root;
    let host;
    let confirmSpy;
    let runMutation;
    beforeEach(async () => {
        confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
        listPendingPrepay.mockResolvedValue({ data: [{ id: 'o1', order_number: 41, total: 30, payment_method_choice: 'yape', payment_state: 'reportado', items: [] }] });
        runPrepayAction.mockResolvedValue({ data: {} });
        runMutation = jest.fn((fn) => fn());
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<PrepayQueue runMutation={runMutation} />));
        await flush();
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        document.body.innerHTML = '';
        confirmSpy.mockRestore();
        jest.clearAllMocks();
    });

    it('asks in the shared dialog, not window.confirm', async () => {
        await click('caja-prepago-rechazar-41');
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(q('confirm-dialog')).not.toBeNull();
        expect(runPrepayAction).not.toHaveBeenCalled();
        await click('confirm-dialog-confirm');
        expect(runPrepayAction).toHaveBeenCalledWith('o1', 'reject');
    });

    it('does nothing when the dialog is cancelled', async () => {
        await click('caja-prepago-rechazar-41');
        await click('confirm-dialog-cancel');
        expect(runPrepayAction).not.toHaveBeenCalled();
    });
});
