import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Login from '@/pages/Login';

jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    Navigate: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/login', state: null }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, login: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(() => Promise.resolve({ data: {} })) } }));

describe('login demo accounts', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it('shows the demo accounts outside production builds', () => {
        process.env.NODE_ENV = 'development';
        const markup = renderToStaticMarkup(<Login />);
        expect(markup).toContain('Cuentas demo');
        expect(markup).toContain('demo-admin-button');
    });

    it('never renders demo credentials in production builds', () => {
        process.env.NODE_ENV = 'production';
        const markup = renderToStaticMarkup(<Login />);
        expect(markup).not.toContain('Cuentas demo');
        expect(markup).not.toContain('demo-admin-button');
        expect(markup).not.toContain('admin@resto.com');
        expect(markup).toContain('login-email-input');
    });
});
