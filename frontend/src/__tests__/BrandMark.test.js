import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandMark, getSafeLogoUrl } from '../components/BrandMark';

describe('getSafeLogoUrl', () => {
    it('accepts HTTPS and root-relative logo URLs', () => {
        expect(getSafeLogoUrl('https://cdn.example.com/mark.png')).toBe('https://cdn.example.com/mark.png');
        expect(getSafeLogoUrl('/uploads/mark.png')).toBe('/uploads/mark.png');
    });

    it('accepts the image data URLs that Ajustes saves from FileReader', () => {
        const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';
        expect(getSafeLogoUrl(jpeg)).toBe(jpeg);
        expect(getSafeLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(getSafeLogoUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
    });

    it('rejects non-image or non-base64 data URLs', () => {
        expect(getSafeLogoUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
        expect(getSafeLogoUrl('data:image/svg+xml,<svg onload="alert(1)"></svg>')).toBeNull();
    });

    it('rejects executable and protocol-relative URLs', () => {
        expect(getSafeLogoUrl('javascript:alert(1)')).toBeNull();
        expect(getSafeLogoUrl('//cdn.example.com/mark.png')).toBeNull();
    });

    it('rejects root-relative paths that normalize to another origin', () => {
        const path = String.raw`/\evil.example/logo.png`;
        expect(new URL(path, 'https://restaurant.example/').origin).toBe('https://evil.example');
        expect(getSafeLogoUrl(path)).toBeNull();
    });
});

describe('BrandMark', () => {
    it('renders a configured logo as decorative beside the restaurant name', () => {
        const markup = renderToStaticMarkup(<BrandMark name="Casa Andina" logoUrl="https://cdn.example.com/logo.png" />);
        expect(markup).toContain('Casa Andina');
        expect(markup).toContain('src="https://cdn.example.com/logo.png"');
        expect(markup).toContain('alt=""');
    });

    it('renders a logo saved as a data URL beside the restaurant name', () => {
        const logo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';
        const markup = renderToStaticMarkup(<BrandMark name="Sabores de Cheo" logoUrl={logo} />);
        expect(markup).toContain(`src="${logo}"`);
        expect(markup).toContain('Sabores de Cheo');
    });

    it('renders the steam-and-plate fallback when no logo is configured', () => {
        const markup = renderToStaticMarkup(<BrandMark name="Sabor Peruano" />);
        expect(markup).toContain('<svg');
        expect(markup).not.toContain('<img');
    });
});
