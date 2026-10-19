import { get, post } from './request';

export const login = (email, password) => post('/auth/login', { email, password });

/** The current user as the server sees it now (role, functions), not the login-time snapshot. */
export const getMe = () => get('/auth/me');
