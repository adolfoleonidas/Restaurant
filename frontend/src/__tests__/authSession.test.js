import { expireSession, isPublicPath } from '@/lib/authSession';

const fakeWindow = (pathname) => ({ location: { pathname, href: pathname } });

describe('expireSession', () => {
    beforeEach(() => {
        localStorage.setItem('token', 'tkn');
        localStorage.setItem('user', '{"id":"u1"}');
    });
    afterEach(() => localStorage.clear());

    it('clears the session and sends a private page to /login', () => {
        const win = fakeWindow('/mesas');
        expect(expireSession(win)).toBe(true);
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();
        expect(win.location.href).toBe('/login');
    });

    it.each(['/', '/login', '/menu/abc', '/checkout', '/pedido/XYZ'])(
        'leaves the public page %s alone',
        (path) => {
            const win = fakeWindow(path);
            expect(isPublicPath(path)).toBe(true);
            expect(expireSession(win)).toBe(false);
            expect(localStorage.getItem('token')).toBe('tkn');
            expect(win.location.href).toBe(path);
        },
    );
});
