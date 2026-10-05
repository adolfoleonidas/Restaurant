import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), patch: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
    const { darkMode, toggle, theme, setTheme } = useTheme();
    return (
        <div>
            <span data-testid="dm">{String(darkMode)}</span>
            <span data-testid="th">{theme}</span>
            <button type="button" data-testid="toggle" onClick={toggle}>toggle</button>
            <button type="button" data-testid="set-calido" onClick={() => setTheme('calido')}>calido</button>
        </div>
    );
}

describe('tema y modo oscuro', () => {
    let container;
    let root;

    beforeEach(() => {
        localStorage.clear();
        document.body.className = '';
        document.head.querySelectorAll('#theme-css').forEach((node) => node.remove());
        api.get.mockReset();
        api.get.mockResolvedValue({ data: { theme_id: 'fresco' } });
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        document.body.innerHTML = '';
        document.body.className = '';
    });

    const render = async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<ThemeProvider><Probe /></ThemeProvider>));
    };

    it('aplica y quita la clase dark, y persiste la elección', async () => {
        await render();
        expect(document.body.classList.contains('theme-fresco')).toBe(true);
        expect(document.body.classList.contains('dark')).toBe(false);

        await act(async () => container.querySelector('[data-testid="toggle"]').click());
        expect(document.body.classList.contains('dark')).toBe(true);
        expect(localStorage.getItem('restaurant-dark-mode')).toBe('true');

        await act(async () => container.querySelector('[data-testid="toggle"]').click());
        expect(document.body.classList.contains('dark')).toBe(false);
        expect(localStorage.getItem('restaurant-dark-mode')).toBe('false');
    });

    it('al cambiar de tema carga su hoja y no deja clases viejas', async () => {
        await render();
        await act(async () => container.querySelector('[data-testid="set-calido"]').click());

        expect(document.body.classList.contains('theme-calido')).toBe(true);
        expect(document.body.classList.contains('theme-fresco')).toBe(false);
        const link = document.head.querySelector('#theme-css');
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toBe('/themes/theme-calido.css');
    });
});
