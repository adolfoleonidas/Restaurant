import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TransferPanel from '@/components/cobro/TransferPanel';
import { BrandMark } from '@/components/BrandMark';
import { printCajaReceipt } from '@/lib/printReceipt';

describe('TransferPanel', () => {
    it('is hidden until bank data is configured', () => {
        expect(renderToStaticMarkup(<TransferPanel method="transfer" />)).toBe('');
        expect(renderToStaticMarkup(<TransferPanel method="transfer" transfer={{ bank_name: '', bank_account: '' }} />)).toBe('');
    });

    it('shows only the configured bank data', () => {
        const markup = renderToStaticMarkup(
            <TransferPanel method="transfer" transfer={{ bank_name: 'BCP', bank_account: '194-1', bank_cci: '', bank_holder: 'Casa Andina SAC' }} />,
        );
        expect(markup).toContain('BCP');
        expect(markup).toContain('194-1');
        expect(markup).toContain('Casa Andina SAC');
        expect(markup).not.toContain('muestra');
    });

    it('renders nothing for other methods', () => {
        expect(renderToStaticMarkup(<TransferPanel method="cash" transfer={{ bank_name: 'BCP' }} />)).toBe('');
    });
});

describe('no hardcoded restaurant identity', () => {
    it('BrandMark has no default restaurant name or neighbourhood', () => {
        const markup = renderToStaticMarkup(<BrandMark />);
        expect(markup).not.toContain('Sabor Peruano');
        expect(markup).not.toContain('Barranco');
    });

    it('the receipt prints the restaurant name it is given', () => {
        const write = jest.fn();
        window.open = jest.fn(() => ({ document: { write, close: jest.fn() }, focus: jest.fn(), print: jest.fn() }));
        printCajaReceipt({ restaurantName: 'Casa Andina', label: 'Mesa 1', order: { order_number: 3, items: [] }, payment: { amount: 5, method: 'efectivo' }, items: [] });
        expect(write.mock.calls[0][0]).toContain('<h1>Casa Andina</h1>');
    });

    it('the receipt never falls back to a made-up name', () => {
        const write = jest.fn();
        window.open = jest.fn(() => ({ document: { write, close: jest.fn() }, focus: jest.fn(), print: jest.fn() }));
        printCajaReceipt({ label: 'Mesa 1', order: { order_number: 3, items: [] }, payment: { amount: 5, method: 'efectivo' }, items: [] });
        expect(write.mock.calls[0][0]).not.toContain('Sabor Peruano');
    });
});
