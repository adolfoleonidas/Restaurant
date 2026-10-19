import axios from 'axios';
import { expireSession } from '@/lib/authSession';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Without a timeout a captive portal or half-open mobile link leaves a request
// pending forever and the offline banner never shows. A call that needs longer
// (or shorter) overrides it per request, e.g. lib/api/orders.js.
export const REQUEST_TIMEOUT_MS = 20000;

export const api = axios.create({ baseURL: API, timeout: REQUEST_TIMEOUT_MS });

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (r) => r,
    (err) => {
        if (err.response && err.response.status === 401) expireSession();
        return Promise.reject(err);
    }
);
