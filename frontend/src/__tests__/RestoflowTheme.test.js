/**
 * Selector de temas (Configuración) con la paleta nueva RestoFlow.
 *
 * La opción nace del mismo `themes` del ThemeContext y pasa por el mismo
 * guardado (PATCH del restaurante + override local + hoja CSS bajo demanda).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Temas } from '@/pages/Configuracion';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

describe('selector de temas · paleta RestoFlow', () => {
    let host;
    let root;

    beforeEach(() => {
        localStorage.clear();
        document.body.className = '';
        document.head.querySelectorAll('#theme-css').forEach((node) => node.remove());
        api.get.mockReset().mockImplementation((path) => Promise.resolve({
            data: path === '/restaurants/current' ? { id: 'r1', name: 'Resto', theme_id: 'fresco' } : null,
        }));
        api.patch.mockReset().mockResolvedValue({ data: { ok: true } });
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.className = '';
        document.body.innerHTML = '';
    });

    async function renderSelector() {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(<ThemeProvider><Temas /></ThemeProvider>));
        await flush();
    }

    it('ofrece RestoFlow junto a las tres paletas de siempre', async () => {
        await renderSelector();

        for (const id of ['fresco', 'restaurante', 'calido', 'restoflow']) {
            expect(document.body.querySelector(`[data-testid="theme-${id}"]`)).not.toBeNull();
        }
        expect(document.body.querySelector('[data-testid="theme-restoflow"]').textContent).toContain('RestoFlow');
    });

    it('al elegirla la guarda, la persiste y carga su hoja de tokens', async () => {
        await renderSelector();

        await act(async () => document.body.querySelector('[data-testid="theme-restoflow"]').click());
        await flush();

        expect(api.patch).toHaveBeenCalledWith('/restaurants/current', { theme_id: 'restoflow' });
        expect(localStorage.getItem('restaurant-theme')).toBe('restoflow');
        expect(document.body.classList.contains('theme-restoflow')).toBe(true);
        const link = document.head.querySelector('#theme-css');
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toBe('/themes/theme-restoflow.css');
    });
});
