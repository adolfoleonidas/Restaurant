import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Configuracion from '@/pages/Configuracion';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const tables = [
    { id: 'table-a', name: 'Mesa A', number: 1, area: 'Salón', capacity: 4, status: 'disponible', qr_status: 'active' },
    { id: 'table-b', name: 'Mesa B', number: 2, area: 'Salón', capacity: 2, status: 'disponible', qr_status: 'none' },
    { id: 'table-c', name: 'Mesa C', number: 3, area: 'Terraza', capacity: 4, status: 'disponible', qr_status: 'revoked' },
];
const mountedViews = [];

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

async function renderPage() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Configuracion />));
    await flush();
    const view = { host, root };
    mountedViews.push(view);
    return view;
}

async function cleanup(view) {
    await act(async () => view.root.unmount());
    view.host.remove();
    const index = mountedViews.indexOf(view);
    if (index >= 0) mountedViews.splice(index, 1);
    document.body.innerHTML = '';
}

async function click(testId) {
    await act(async () => document.body.querySelector(`[data-testid="${testId}"]`).click());
    await flush();
}

describe('configuration table guest links', () => {
    let confirmSpy;
    beforeEach(() => {
        api.get.mockReset().mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [{ id: 'zone-a', name: 'Salón' }, { id: 'zone-b', name: 'Terraza' }]
                    : path === '/restaurants/current' ? { name: 'Restaurant' } : null,
        }));
        api.post.mockReset().mockResolvedValue({ data: { ok: true, qr_status: 'revoked' } });
        confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    });
    afterEach(async () => {
        for (const view of [...mountedViews]) await cleanup(view);
        confirmSpy.mockRestore();
        document.body.innerHTML = '';
    });

    it('does not retrieve or expose a guest token while listing active, absent, and revoked QR states', async () => {
        const view = await renderPage();
        expect(api.get).toHaveBeenCalledWith('/tables');
        expect(api.get.mock.calls.some(([path]) => path.endsWith('/guest-link'))).toBe(false);
        expect(document.body.textContent).toContain('QR activo');
        expect(document.body.textContent).toContain('Sin QR');
        expect(document.body.textContent).toContain('QR revocado');
        expect(document.body.innerHTML).not.toContain('mesa=');
        await cleanup(view);
    });

    it('retrieves a link only after explicit request and displays open/copy controls', async () => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' }
                    : path === '/tables/table-a/guest-link' ? { path: '/checkout?mesa=private-table-token', table_number: 1 } : null,
        }));
        const view = await renderPage();
        await click('mesa-qr-link-table-a');
        expect(api.get).toHaveBeenCalledWith('/tables/table-a/guest-link');
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-a"]').value).toBe(`${window.location.origin}/checkout?mesa=private-table-token`);
        expect(document.body.querySelector('[data-testid="mesa-qr-open-table-a"]').getAttribute('href')).toBe(`${window.location.origin}/checkout?mesa=private-table-token`);
        await cleanup(view);
    });

    it('keeps the link created from an absent QR after updating its visible status', async () => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' }
                    : { path: '/checkout?mesa=created-token', table_number: 2 },
        }));
        const view = await renderPage();
        await click('mesa-qr-link-table-b');
        expect(document.body.querySelector('[data-testid="mesa-qr-status-table-b"]').textContent).toContain('QR activo');
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-b"]').value).toContain('created-token');
        await cleanup(view);
    });

    it('tracks request busy state independently for each table', async () => {
        let resolveLink;
        api.get.mockImplementation((path) => path === '/tables/table-a/guest-link'
            ? new Promise((resolve) => { resolveLink = resolve; })
            : Promise.resolve({ data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' }
                    : { path: '/checkout?mesa=table-b-token', table_number: 2 } }));
        const view = await renderPage();
        await act(async () => document.body.querySelector('[data-testid="mesa-qr-link-table-a"]').click());
        expect(document.body.querySelector('[data-testid="mesa-qr-link-table-a"]').disabled).toBe(true);
        expect(document.body.querySelector('[data-testid="mesa-qr-link-table-b"]').disabled).toBe(false);
        await act(async () => resolveLink({ data: { path: '/checkout?mesa=table-a-token', table_number: 1 } }));
        await flush();
        await cleanup(view);
    });

    it('confirms rotation, replaces the shown link, and clears it if the request fails', async () => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' }
                    : { path: '/checkout?mesa=old-token', table_number: 1 },
        }));
        api.post.mockResolvedValueOnce({ data: { path: '/checkout?mesa=new-token', table_number: 1 } })
            .mockRejectedValueOnce(new Error('connection lost'));
        const view = await renderPage();
        await click('mesa-qr-link-table-a');
        await click('mesa-qr-rotate-table-a');
        expect(confirmSpy).toHaveBeenCalled();
        expect(api.post).toHaveBeenCalledWith('/tables/table-a/qr/rotate');
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-a"]').value).toContain('new-token');
        expect(document.body.innerHTML).not.toContain('old-token');
        await click('mesa-qr-rotate-table-a');
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-a"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-qr-error-table-a"]')).not.toBeNull();
        await cleanup(view);
    });

    it('requires confirmation before revoking and clears the link after success', async () => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' }
                    : { path: '/checkout?mesa=old-token', table_number: 1 },
        }));
        const view = await renderPage();
        await click('mesa-qr-link-table-a');
        confirmSpy.mockReturnValueOnce(false);
        await click('mesa-qr-revoke-table-a');
        expect(api.post).not.toHaveBeenCalled();
        confirmSpy.mockReturnValueOnce(true);
        await click('mesa-qr-revoke-table-a');
        expect(api.post).toHaveBeenCalledWith('/tables/table-a/qr/revoke');
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-a"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-qr-status-table-a"]').textContent).toContain('QR revocado');
        await cleanup(view);
    });

    it('keeps per-table state independent and provides a manual-copy fallback', async () => {
        api.get.mockImplementation((path) => Promise.resolve({
            data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' }
                    : { path: '/checkout?mesa=table-a-token', table_number: 1 },
        }));
        const originalClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
        const view = await renderPage();
        await click('mesa-qr-link-table-a');
        await click('mesa-qr-copy-table-a');
        expect(document.body.querySelector('[data-testid="mesa-qr-copy-fallback-table-a"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-b"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-qr-status-table-b"]').textContent).toContain('Sin QR');
        await cleanup(view);
        if (originalClipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
        else delete navigator.clipboard;
    });

    it('reports link retrieval failures without displaying a partial or stale link', async () => {
        api.get.mockImplementation((path) => path === '/tables/table-a/guest-link'
            ? Promise.reject(new Error('connection lost'))
            : Promise.resolve({ data: path === '/tables' ? tables.map((table) => ({ ...table }))
                : path === '/zones' ? [] : path === '/restaurants/current' ? { name: 'Restaurant' } : null }));
        const view = await renderPage();
        await click('mesa-qr-link-table-a');
        expect(document.body.querySelector('[data-testid="mesa-qr-error-table-a"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-qr-url-table-a"]')).toBeNull();
        await cleanup(view);
    });
});
