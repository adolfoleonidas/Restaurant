import { api, API } from '@/lib/api';

/**
 * Thin helpers over the shared axios instance. Trailing `undefined` arguments
 * are dropped so a wrapper produces exactly the call a hand-written
 * `api.get(url)` or `api.post(url, body)` would.
 */
const trim = (args) => {
    const out = [...args];
    while (out.length && out[out.length - 1] === undefined) out.pop();
    return out;
};

export const get = (url, config) => api.get(...trim([url, config]));
export const post = (url, body, config) => api.post(...trim([url, body, config]));
export const patch = (url, body, config) => api.patch(...trim([url, body, config]));
export const put = (url, body, config) => api.put(...trim([url, body, config]));
export const del = (url, config) => api.delete(...trim([url, config]));

/** `{ params }` when there are params, otherwise no config at all. */
export const withParams = (params) => (params ? { params } : undefined);

const KEEPALIVE_TIMEOUT_MS = 15000;

/**
 * The same call through `fetch` with `keepalive`: the browser finishes it even
 * when the page is hidden or closing, which an XHR (axios) does not survive. It
 * answers like axios, `{ data }`, and rejects with `{ response: { status, data } }`
 * so errors are read the same way. The session token travels as the api client
 * sends it; an expired one (401) is left to the next normal request, which
 * redirects to the login.
 */
export async function keepaliveRequest(method, url, body) {
    let token = null;
    try { token = localStorage.getItem('token'); } catch { /* storage blocked */ }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), KEEPALIVE_TIMEOUT_MS) : null;
    let response;
    try {
        response = await fetch(`${API}${url}`, {
            method,
            keepalive: true,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
            signal: controller?.signal,
        });
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
    let data = null;
    try { data = await response.json(); } catch { /* an answer without a body */ }
    if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { response: { status: response.status, data } });
    }
    return { data, status: response.status };
}
