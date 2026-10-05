import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '@/components/ErrorBoundary';

global.IS_REACT_ACT_ENVIRONMENT = true;

function Boom() {
    throw new Error('boom de prueba');
}

describe('ErrorBoundary', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        // El boundary loguea el error a consola a propósito: no ensuciar la salida.
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    it('muestra el error en vez de dejar la pantalla en blanco', async () => {
        await act(async () => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));

        expect(document.body.querySelector('[data-testid="app-error-boundary"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="app-error-message"]').textContent).toContain('boom de prueba');
        expect(document.body.querySelector('[data-testid="app-error-retry"]')).not.toBeNull();
    });

    it('deja pasar el contenido cuando no hay error', async () => {
        await act(async () => root.render(<ErrorBoundary><div data-testid="ok">ok</div></ErrorBoundary>));

        expect(document.body.querySelector('[data-testid="ok"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="app-error-boundary"]')).toBeNull();
    });
});
