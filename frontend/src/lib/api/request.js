import { api } from '@/lib/api';

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
