import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

global.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Minimal hook harness (no @testing-library): renders `callback(props)` inside a
 * probe component and exposes the latest return value as `result.current`.
 */
export async function renderHook(callback, initialProps) {
    const result = { current: null };
    function Probe({ hookProps }) {
        result.current = callback(hookProps);
        return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Probe hookProps={initialProps} />); });
    return {
        result,
        rerender: (props) => act(async () => { root.render(<Probe hookProps={props} />); }),
        unmount: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

/** Lets pending promise callbacks and the state they set settle. */
export const flush = () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
});

/**
 * Waits until `assert` stops throwing, flushing React between attempts.
 *
 * Only needed when the number of promise ticks is not knowable up front — a save
 * that reloads, a click that chains two requests. For a single settle, `flush()`
 * is enough and reads better. Replaces @testing-library's `waitFor` so the suite
 * keeps zero test dependencies (see the harness note above).
 */
export async function waitFor(assert, { timeout = 1000, interval = 5 } = {}) {
    const deadline = Date.now() + timeout;
    let lastError;
    for (;;) {
        try {
            return await act(async () => {
                await Promise.resolve();
                return assert();
            });
        } catch (error) {
            lastError = error;
        }
        if (Date.now() > deadline) throw lastError;
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, interval));
        });
    }
}
