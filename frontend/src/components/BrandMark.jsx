import React, { useState } from 'react';

// El logo se guarda como data URL desde Ajustes (FileReader). Solo se aceptan
// imágenes raster/SVG en base64: nunca `data:text/html` ni SVG con marcado
// suelto. La CSP de nginx ya permite `img-src data:`.
const SAFE_LOGO_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i;

export function getSafeLogoUrl(value) {
    if (typeof value !== 'string') return null;
    const url = value.trim();
    if (!url) return null;
    if (url.startsWith('data:')) {
        return SAFE_LOGO_DATA_URL.test(url) ? url : null;
    }
    try {
        if (url.startsWith('/')) {
            const parsed = new URL(url, 'https://restaurant.invalid');
            return parsed.origin === 'https://restaurant.invalid' ? url : null;
        }
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
    } catch {
        return null;
    }
}

function BrandSymbol() {
    return (
        <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden="true" focusable="false">
            <path d="M11 29h26c-.8 7.1-5.9 11-13 11S11.8 36.1 11 29Z" fill="currentColor" />
            <path d="M8 27c4-2.2 8-2.2 12 0s8 2.2 12 0 6-2.2 8-1.4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M17 21c-2-2.2-1.5-4.4.2-6.3 1.5-1.7 1.6-3.4.2-5.2M25 20c-2-2.3-1.5-4.7.2-6.7 1.5-1.8 1.7-3.6.2-5.4M33 21c-2-2.2-1.5-4.4.2-6.3 1.5-1.7 1.6-3.4.2-5.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
    );
}

export function BrandMark({ name = 'Restaurante', kicker = '', compact = false, logoUrl }) {
    const safeLogoUrl = getSafeLogoUrl(logoUrl);
    const [failedUrl, setFailedUrl] = useState(null);
    const showLogo = safeLogoUrl && failedUrl !== safeLogoUrl;
    const markSize = compact ? 'h-9 w-9' : 'h-11 w-11';

    return (
        <div className="flex items-center gap-3 min-w-0">
            <span className={`${markSize} shrink-0 rounded-2xl bg-primary/10 p-1.5 text-primary ring-1 ring-primary/20`} aria-hidden="true">
                {showLogo ? (
                    <img
                        src={safeLogoUrl}
                        alt=""
                        className="h-full w-full rounded-xl object-contain"
                        onError={() => setFailedUrl(safeLogoUrl)}
                    />
                ) : <BrandSymbol />}
            </span>
            <span className="min-w-0 -ml-0.5">
                <span className={`block font-display leading-tight truncate ${compact ? 'text-base' : 'text-lg'} font-semibold`}>
                    {name}
                </span>
                {!compact && kicker ? (
                    <span className="page-kicker block truncate">{kicker}</span>
                ) : null}
            </span>
        </div>
    );
}
