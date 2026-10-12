import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import usePendingAction from '@/hooks/usePendingAction';
import PendingButton from '@/components/ui/pending-button';
import { renderHook } from '@/test-utils/renderHook';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

beforeEach(() => { Object.values(toast).forEach((fn) => fn.mockReset()); });

describe('usePendingAction', () => {
    test('marks the key pending while it runs and ignores repeat taps without a second call', async () => {
        let resolve;
        const fn = jest.fn(() => new Promise((r) => { resolve = r; }));
        const hook = await renderHook(() => usePendingAction());
        let first; let second;
        await act(async () => { first = hook.result.current[0]('deliver:1', fn); });
        await act(async () => { second = hook.result.current[0]('deliver:1', fn); });
        expect(fn).toHaveBeenCalledTimes(1);
        expect(hook.result.current[1].has('deliver:1')).toBe(true);
        expect(await second).toBeUndefined();
        await act(async () => { resolve('ok'); await first; });
        expect(await first).toBe('ok');
        expect(hook.result.current[1].has('deliver:1')).toBe(false);
        await hook.unmount();
    });

    test('different keys run independently', async () => {
        const fn = jest.fn(() => new Promise(() => {}));
        const hook = await renderHook(() => usePendingAction());
        await act(async () => { hook.result.current[0]('a', fn); hook.result.current[0]('b', fn); });
        expect(fn).toHaveBeenCalledTimes(2);
        await hook.unmount();
    });

    test('failures go through apiErrorMessage, clear the key and allow a retry', async () => {
        const fn = jest.fn().mockRejectedValueOnce({ response: { data: { detail: 'Nada para avanzar' } } }).mockResolvedValueOnce('ok');
        const onError = jest.fn();
        const hook = await renderHook(() => usePendingAction());
        await act(async () => { await hook.result.current[0]('k', fn, { errorMessage: 'No se pudo', onError }); });
        expect(toast.error).toHaveBeenCalledWith('Nada para avanzar');
        expect(onError).toHaveBeenCalled();
        expect(hook.result.current[1].has('k')).toBe(false);
        await act(async () => { await hook.result.current[0]('k', fn); });
        expect(fn).toHaveBeenCalledTimes(2);
        await hook.unmount();
    });

    test('uses the fallback message when the error has no detail', async () => {
        const hook = await renderHook(() => usePendingAction());
        await act(async () => { await hook.result.current[0]('k', () => Promise.reject(new Error('x')), { errorMessage: 'No se pudo entregar' }); });
        expect(toast.error).toHaveBeenCalledWith('No se pudo entregar');
        await hook.unmount();
    });
});

describe('PendingButton', () => {
    let host; let root;
    beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
    afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

    test('shows the pending label, disables itself and flags aria-busy', async () => {
        await act(async () => root.render(<PendingButton pending pendingLabel="Entregando…">Entregar</PendingButton>));
        const btn = host.querySelector('button');
        expect(btn.textContent).toBe('Entregando…');
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute('aria-busy')).toBe('true');
    });

    test('renders its children when idle', async () => {
        await act(async () => root.render(<PendingButton pending={false} pendingLabel="Entregando…">Entregar</PendingButton>));
        const btn = host.querySelector('button');
        expect(btn.textContent).toBe('Entregar');
        expect(btn.disabled).toBe(false);
        expect(btn.getAttribute('aria-busy')).toBeNull();
    });
});
