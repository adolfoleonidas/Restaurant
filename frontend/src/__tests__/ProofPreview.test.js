import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProofPreview from '@/components/ProofPreview';

global.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

const render = async (element) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(element));
    return host;
};

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

describe('ProofPreview', () => {
    test('shows the image with the given height class', async () => {
        const view = await render(<ProofPreview url="data:image/png;base64,AAA" maxHeightClass="max-h-40" emptyText="Nada" />);
        const img = view.querySelector('img');
        expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA');
        expect(img.getAttribute('alt')).toBe('Comprobante');
        expect(img.className).toBe('mt-2 max-h-40 rounded-sm border');
        expect(view.textContent).toBe('');
    });

    test('shows the empty text in a div by default', async () => {
        const view = await render(<ProofPreview url={null} maxHeightClass="max-h-40" emptyText="No hay imagen de comprobante." />);
        expect(view.querySelector('img')).toBeNull();
        const empty = view.firstChild;
        expect(empty.tagName).toBe('DIV');
        expect(empty.className).toBe('mt-2 text-xs text-muted-foreground');
        expect(empty.textContent).toBe('No hay imagen de comprobante.');
    });

    test('the empty text can be a paragraph', async () => {
        const view = await render(<ProofPreview url="" maxHeightClass="max-h-72" emptyText="Sin imagen" emptyAs="p" />);
        expect(view.firstChild.tagName).toBe('P');
    });
});
