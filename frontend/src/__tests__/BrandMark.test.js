import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandMark, getSafeLogoUrl } from '../components/BrandMark';

describe('getSafeLogoUrl', () => {
    it('accepts HTTPS and root-relative logo URLs', () => {
        expect(getSafeLogoUrl('https://cdn.example.com/mark.png')).toBe('https://cdn.example.com/mark.png');
        expect(getSafeLogoUrl('/uploads/mark.png')).toBe('/uploads/mark.png');
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

    it('renders the steam-and-plate fallback when no logo is configured', () => {
        const markup = renderToStaticMarkup(<BrandMark name="Sabor Peruano" />);
        expect(markup).toContain('<svg');
        expect(markup).not.toContain('<img');
    });
});
