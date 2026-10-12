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
