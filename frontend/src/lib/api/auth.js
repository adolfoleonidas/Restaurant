import { post } from './request';

export const login = (email, password) => post('/auth/login', { email, password });
