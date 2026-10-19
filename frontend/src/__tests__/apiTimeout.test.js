import axios from 'axios';
import { api, REQUEST_TIMEOUT_MS } from '@/lib/api';
import { expireSession } from '@/lib/authSession';

jest.mock('axios', () => {
    const instance = {
        interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    };
    return { __esModule: true, default: { create: jest.fn(() => instance) } };
});
jest.mock('@/lib/authSession', () => ({ expireSession: jest.fn() }));

// CRA resets every mock before each test, so what api.js did at import time is
// captured here, once, while the module loads.
const createConfigs = axios.create.mock.calls.map(([config]) => config);
const onRejected = api.interceptors.response.use.mock.calls[0][1];

describe('shared axios instance', () => {
    it('has a default timeout so a half-open connection fails instead of hanging', () => {
        expect(REQUEST_TIMEOUT_MS).toBe(20000);
        expect(createConfigs).toContainEqual(expect.objectContaining({ timeout: 20000 }));
    });

    it('gives every axios instance the module creates a timeout', () => {
        expect(createConfigs.length).toBeGreaterThan(0);
        createConfigs.forEach((config) => {
            expect(config.timeout).toBeGreaterThan(0);
        });
    });

    describe('401 interceptor', () => {
        it('routes a 401 through the shared session-expiry path', async () => {
            const err = { response: { status: 401 } };
            await expect(onRejected(err)).rejects.toBe(err);
            expect(expireSession).toHaveBeenCalledTimes(1);
        });

        it('leaves other failures alone', async () => {
            const err = { code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' };
            await expect(onRejected(err)).rejects.toBe(err);
            expect(expireSession).not.toHaveBeenCalled();
        });
    });
});
