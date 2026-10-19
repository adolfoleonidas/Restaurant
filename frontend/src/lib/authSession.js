// Pages a visitor can use without an account: an expired session there is not an
// error worth throwing them to the login screen for.
const PUBLIC_SEGMENTS = ['/menu', '/checkout', '/pedido'];

export function isPublicPath(path) {
    // Whole path segments only: '/pedidos' and '/gestion/menu' are staff pages and
    // must not be mistaken for the public '/pedido/:code' and '/menu'.
    return path === '/' || path === '/login' || PUBLIC_SEGMENTS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The session is no longer valid (the server answered 401): forget it and go to
 * the login screen. Shared by the axios interceptor and the raw-fetch realtime
 * stream, which bypasses that interceptor. Returns whether it logged out.
 */
export function expireSession(win = window) {
    if (isPublicPath(win.location.pathname)) return false;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    win.location.href = '/login';
    return true;
}
