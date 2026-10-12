import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '@/components/AppShell';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({
    NavLink: ({ children, to, className, ...props }) => (
        <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className} {...props}>{children}</a>
    ),
    Outlet: () => <p>contenido</p>,
    useNavigate: () => jest.fn(),
}));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1', full_name: 'Ana', role: 'admin', restaurant_id: 'r1' }, logout: jest.fn() }),
}));
jest.mock('@/contexts/NotifyContext', () => ({
    NotifyProvider: ({ children }) => children,
    useNotify: () => ({ generation: 0 }),
}));
jest.mock('@/lib/api/restaurant', () => ({ getRestaurant: () => Promise.resolve({ data: { name: 'Casa Andina' } }) }));
jest.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/KitchenAlerts', () => ({ KitchenAlerts: () => null }));
jest.mock('@/components/AssistantBar', () => ({ AssistantBar: () => null }));
jest.mock('@/components/RoleInbox', () => ({ RoleInbox: () => null }));
jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

describe('app shell skip link', () => {
    it('is the first focusable element and points at the main landmark', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => root.render(<AppShell />));
        const link = host.querySelector('a[href="#contenido"]');
        expect(link).not.toBeNull();
        expect(link.textContent).toBe('Saltar al contenido');
        expect(host.querySelector('a, button')).toBe(link);
        const main = host.querySelector('main');
        expect(main.id).toBe('contenido');
        expect(main.getAttribute('tabindex')).toBe('-1');
        await act(async () => root.unmount());
        host.remove();
    });
});
