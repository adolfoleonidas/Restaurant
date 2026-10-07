import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), patch: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
    const { darkMode, kitchenDark, toggle, theme, setTheme, setActivePath, themes } = useTheme();
    return (
        <div>
            <span data-testid="dm">{String(darkMode)}</span>
            <span data-testid="kitchen">{String(kitchenDark)}</span>
            <span data-testid="th">{theme}</span>
            <span data-testid="theme-ids">{themes.map((t) => t.id).join(',')}</span>
            <button type="button" data-testid="toggle" onClick={toggle}>toggle</button>
            <button type="button" data-testid="set-calido" onClick={() => setTheme('calido')}>calido</button>
            <button type="button" data-testid="set-restoflow" onClick={() => setTheme('restoflow')}>restoflow</button>
            <button type="button" data-testid="ir-cocina" onClick={() => setActivePath('/cocina')}>cocina</button>
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

    it('suma la paleta RestoFlow: aparece en la lista, carga su hoja y persiste', async () => {
        await render();
        expect(container.querySelector('[data-testid="theme-ids"]').textContent).toContain('restoflow');

        await act(async () => container.querySelector('[data-testid="set-restoflow"]').click());

        expect(document.body.classList.contains('theme-restoflow')).toBe(true);
        expect(document.body.classList.contains('theme-fresco')).toBe(false);
        const link = document.head.querySelector('#theme-css');
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toBe('/themes/theme-restoflow.css');
        expect(localStorage.getItem('restaurant-theme')).toBe('restoflow');
    });

    it('la cocina ya no se pone oscura por su cuenta', async () => {
        await render();
        expect(document.body.classList.contains('dark')).toBe(false);

        await act(async () => container.querySelector('[data-testid="ir-cocina"]').click());
        expect(container.querySelector('[data-testid="kitchen"]').textContent).toBe('true');
        // Entrar al pase no cambia el tema ni deja una elección grabada.
        expect(document.body.classList.contains('dark')).toBe(false);
        expect(localStorage.getItem('restaurant-dark-mode')).toBeNull();
    });

    it('respeta el tema del dispositivo cuando el usuario aún no eligió', async () => {
        const original = window.matchMedia;
        window.matchMedia = (query) => ({ matches: query.includes('dark'), addEventListener: () => {}, removeEventListener: () => {} });
        try {
            await render();
            expect(document.body.classList.contains('dark')).toBe(true);
            await act(async () => container.querySelector('[data-testid="ir-cocina"]').click());
            expect(document.body.classList.contains('dark')).toBe(true);
            // Sigue sin ser una elección de la app.
            expect(localStorage.getItem('restaurant-dark-mode')).toBeNull();
        } finally {
            window.matchMedia = original;
        }
    });

    it('la elección del usuario gana sobre el tema del dispositivo', async () => {
        const original = window.matchMedia;
        window.matchMedia = (query) => ({ matches: query.includes('dark'), addEventListener: () => {}, removeEventListener: () => {} });
        try {
            await render();
            expect(document.body.classList.contains('dark')).toBe(true);
            // El usuario apaga el oscuro a mano.
            await act(async () => container.querySelector('[data-testid="toggle"]').click());
            expect(document.body.classList.contains('dark')).toBe(false);
            expect(localStorage.getItem('restaurant-dark-mode')).toBe('false');

            await act(async () => container.querySelector('[data-testid="ir-cocina"]').click());
            expect(document.body.classList.contains('dark')).toBe(false);
        } finally {
            window.matchMedia = original;
        }
    });

    it('en la cocina el interruptor sigue funcionando', async () => {
        await render();
        await act(async () => container.querySelector('[data-testid="ir-cocina"]').click());
        expect(document.body.classList.contains('dark')).toBe(false);

        await act(async () => container.querySelector('[data-testid="toggle"]').click());
        expect(document.body.classList.contains('dark')).toBe(true);
        expect(localStorage.getItem('restaurant-dark-mode')).toBe('true');
    });
});
