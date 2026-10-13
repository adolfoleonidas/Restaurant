/**
 * BS-03 in the app shell:
 * - logging out while taps are still unsaved gives them a moment to reach the
 *   server and, if they cannot, asks before it drops them;
 * - what a previous session left unconfirmed on the device is saved when the app
 *   opens for that user, and when the connection comes back.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { saveDraftLines } from '@/lib/api/orders';
import { registerOutbox } from '@/lib/outboxRegistry';
import { outboxStorage } from '@/lib/outboxStorage';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockLogout = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/lib/api/orders', () => ({ saveDraftLines: jest.fn() }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: null, refetch: jest.fn() }) }));
jest.mock('react-router-dom', () => ({
    NavLink: ({ children, to, className, ...props }) => (
        <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className} {...props}>{children}</a>
    ),
    Outlet: () => <p>contenido</p>,
    useNavigate: () => mockNavigate,
}));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1', full_name: 'Ana', role: 'mozo', restaurant_id: 'r1' }, logout: mockLogout }),
}));
jest.mock('@/contexts/NotifyContext', () => ({
    NotifyProvider: ({ children }) => children,
    useNotify: () => ({ generation: 0 }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/api/restaurant', () => ({ getRestaurant: () => Promise.resolve({ data: { name: 'Casa Andina' } }) }));
jest.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/KitchenAlerts', () => ({ KitchenAlerts: () => null }));
jest.mock('@/components/AssistantBar', () => ({ AssistantBar: () => null }));
jest.mock('@/components/RoleInbox', () => ({ RoleInbox: () => null }));
jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

const entry = (extra = {}) => ({
    key: 'new:p1', kind: 'new', productId: 'p1', orderId: 'o1', clientLineId: 'c-1', quantity: 2, ...extra,
});

const settle = () => act(async () => {
    for (let i = 0; i < 40; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
});

describe('app shell and the unsaved outbox', () => {
    let host;
    let root;
    let unregister;
    let outbox;

    const mount = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<AppShell />));
        await settle();
    };
    const clickLogout = async () => {
        await act(async () => {
            document.querySelector('[data-testid="logout-button"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await settle();
    };
    const dialog = () => document.body.querySelector('[data-testid="confirm-dialog"]');
    const press = async (testId) => {
        await act(async () => {
            document.body.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await settle();
    };

    beforeEach(() => {
        localStorage.clear();
        mockLogout.mockReset();
        mockNavigate.mockReset();
        saveDraftLines.mockReset().mockResolvedValue({ data: { line_results: [] } });
        Object.values(toast).forEach((fn) => fn.mockReset());
        outbox = { waiting: false, flush: jest.fn(async () => {}) };
        unregister = registerOutbox({
            pending: () => outbox.waiting,
            orderIds: () => [],
            flush: (options) => outbox.flush(options),
        });
    });

    afterEach(async () => {
        unregister();
        if (root) await act(async () => root.unmount());
        host?.remove();
        root = null;
        host = null;
        document.body.innerHTML = '';
        jest.useRealTimers();
    });

    describe('logging out', () => {
        it('goes out at once when nothing is unsaved', async () => {
            await mount();
            await clickLogout();

            expect(outbox.flush).not.toHaveBeenCalled();
            expect(dialog()).toBeNull();
            expect(mockLogout).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledWith('/login');
        });

        it('gives the last taps a moment to reach the server and then goes out without scaring anyone', async () => {
            outbox.waiting = true;
            outbox.flush.mockImplementation(async () => { outbox.waiting = false; });
            await mount();
            await clickLogout();

            expect(outbox.flush).toHaveBeenCalledTimes(1);
            expect(dialog()).toBeNull();
            expect(mockLogout).toHaveBeenCalledTimes(1);
        });

        it('asks first when the taps could not be saved, and stays if the waiter says so', async () => {
            outbox.waiting = true;
            await mount();
            await clickLogout();

            expect(mockLogout).not.toHaveBeenCalled();
            expect(dialog()).not.toBeNull();
            expect(dialog().textContent).toContain('Tienes pedidos sin guardar');
            expect(dialog().textContent).toContain('no se enviarán hasta que vuelvas a entrar');
            expect(dialog().querySelector('[data-testid="confirm-dialog-confirm"]').textContent).toBe('Salir igual');
            expect(dialog().querySelector('[data-testid="confirm-dialog-cancel"]').textContent).toBe('Quedarme');

            await press('confirm-dialog-cancel');
            expect(dialog()).toBeNull();
            expect(mockLogout).not.toHaveBeenCalled();
        });

        it('leaves when the waiter insists', async () => {
            outbox.waiting = true;
            await mount();
            await clickLogout();
            await press('confirm-dialog-confirm');

            expect(mockLogout).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledWith('/login');
            expect(dialog()).toBeNull();
        });

        it('does not wait for ever on a connection that hangs', async () => {
            jest.useFakeTimers();
            outbox.waiting = true;
            outbox.flush.mockImplementation(() => new Promise(() => {}));
            await mount();
            await act(async () => {
                document.querySelector('[data-testid="logout-button"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            expect(dialog()).toBeNull();

            await act(async () => { jest.advanceTimersByTime(2500); });
            await settle();
            expect(dialog()).not.toBeNull();
            expect(mockLogout).not.toHaveBeenCalled();
        });
    });

    describe('what a previous session left on the device', () => {
        it('is saved when the app opens for that user, and only that user', async () => {
            await outboxStorage.save('u1', 'o1', [entry()]);
            await outboxStorage.save('someone-else', 'o9', [entry({ orderId: 'o9' })]);
            await mount();

            expect(saveDraftLines).toHaveBeenCalledTimes(1);
            expect(saveDraftLines).toHaveBeenCalledWith('o1', [{ client_line_id: 'c-1', product_id: 'p1', quantity: 2 }]);
            // Saved, so it is not on the device any more; the other user's stays for them.
            expect(await outboxStorage.load('u1', 'o1')).toEqual([]);
            expect(await outboxStorage.load('someone-else', 'o9')).toHaveLength(1);
            expect(toast.error).not.toHaveBeenCalled();
        });

        it('is tried again when the connection comes back, if the first try could not reach the server', async () => {
            await outboxStorage.save('u1', 'o1', [entry()]);
            saveDraftLines.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} }));
            await mount();
            expect(saveDraftLines).toHaveBeenCalledTimes(1);
            expect(await outboxStorage.load('u1', 'o1')).toHaveLength(1);

            await act(async () => { window.dispatchEvent(new Event('online')); });
            await settle();
            expect(saveDraftLines).toHaveBeenCalledTimes(2);
            expect(await outboxStorage.load('u1', 'o1')).toEqual([]);
        });

        it('tells the waiter when the server did not accept some of it', async () => {
            await outboxStorage.save('u1', 'o1', [entry()]);
            saveDraftLines.mockResolvedValue({
                data: { line_results: [{ client_line_id: 'c-1', result: 'rejected', code: 'unavailable', detail: 'Producto agotado: Sopa' }] },
            });
            await mount();

            expect(toast.error).toHaveBeenCalledTimes(1);
            expect(toast.error.mock.calls[0][0]).toMatch(/no se pudieron agregar/);
        });

        it('does nothing when there is nothing on the device', async () => {
            await mount();
            expect(saveDraftLines).not.toHaveBeenCalled();
        });
    });
});
