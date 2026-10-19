/**
 * Un 429 en el login no puede decir «revisa tu contraseña».
 *
 * nginx corta con un 429 pelado (sin JSON) y el backend con su propio detalle.
 * Con el mensaje genérico el usuario creía haberse equivocado, reintentaba y
 * hundía más el bloqueo. Ahora ambos caminos dicen que hay que esperar.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Login from '@/pages/Login';
import { toast } from 'sonner';
import { api } from '@/lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockLogin = jest.fn();

jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    Navigate: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/login', state: null }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, login: mockLogin }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const typeInto = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => { api.get.mockResolvedValue({ data: {} }); });

let view;
async function submitWith(error) {
    mockLogin.mockRejectedValue(error);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    view = { host, root };
    await act(async () => root.render(<Login />));
    await flush();
    await act(async () => {
        typeInto(host.querySelector('[data-testid="login-email-input"]'), 'mozo@resto.com');
        typeInto(host.querySelector('[data-testid="login-password-input"]'), 'secreto-123');
    });
    await act(async () => host.querySelector('[data-testid="login-submit-button"]').click());
    await flush();
    return host.querySelector('[role="alert"]');
}

afterEach(async () => {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
    jest.clearAllMocks();
});

describe('login rate limiting', () => {
    it('a bare nginx 429 asks to wait, not to check the password', async () => {
        const alert = await submitWith({ response: { status: 429, data: '<html>429</html>' } });
        expect(alert.textContent).toBe('Demasiados intentos. Espera un momento y vuelve a intentar.');
        expect(alert.textContent).not.toMatch(/revisa tu correo/i);
        expect(toast.error).toHaveBeenCalledWith('Demasiados intentos. Espera un momento y vuelve a intentar.');
    });

    it('the backend own 429 reads well too', async () => {
        const alert = await submitWith({ response: { status: 429, data: { detail: 'Demasiados intentos. Espera unos minutos.' } } });
        expect(alert.textContent).toBe('Demasiados intentos. Espera unos minutos.');
    });

    it('a real wrong password still points at the credentials', async () => {
        const alert = await submitWith({ response: { status: 401, data: {} } });
        expect(alert.textContent).toMatch(/revisa tu correo y tu contraseña/i);
    });
});
