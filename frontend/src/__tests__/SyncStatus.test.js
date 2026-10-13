import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SyncStatus from '@/components/SyncStatus';

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('SyncStatus', () => {
    let host;
    let root;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    const show = async (props) => {
        await act(async () => root.render(<SyncStatus {...props} />));
        return host.querySelector('[data-testid]');
    };

    it('says "Guardando…" while the taps are on the way', async () => {
        const node = await show({ state: 'saving' });
        expect(node.textContent).toBe('Guardando…');
        expect(node.getAttribute('data-state')).toBe('saving');
    });

    it('says "Sin guardar" while the taps wait on the device', async () => {
        const node = await show({ state: 'unsaved' });
        expect(node.textContent).toBe('Sin guardar');
        expect(node.getAttribute('data-state')).toBe('unsaved');
        // A warning tone, readable on both themes.
        expect(node.className).toContain('text-amber-700');
        expect(node.className).toContain('dark:text-amber-300');
    });

    it('says nothing once everything is saved, but keeps the live region for the next change', async () => {
        const node = await show({ state: 'idle' });
        expect(node.textContent).toBe('');
        expect(node.getAttribute('role')).toBe('status');
        expect(node.getAttribute('aria-live')).toBe('polite');
        expect(node.getAttribute('data-state')).toBe('idle');
    });

    it('treats an unknown state as saved', async () => {
        const node = await show({ state: 'weird' });
        expect(node.textContent).toBe('');
    });

    it('takes a test id and extra classes', async () => {
        const node = await show({ state: 'saving', testId: 'mesa-sheet-sync', className: 'ml-auto' });
        expect(node.getAttribute('data-testid')).toBe('mesa-sheet-sync');
        expect(node.className).toContain('ml-auto');
    });

    it('has no motion: no transition and no animation classes', async () => {
        const node = await show({ state: 'saving' });
        expect(node.className).not.toMatch(/transition|animate|duration|ease/);
    });
});
