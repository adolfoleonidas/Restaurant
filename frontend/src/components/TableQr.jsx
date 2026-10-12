import React, { useEffect, useMemo, useRef, useState } from 'react';
import { qrMatrix } from '@/lib/qr';

/**
 * Dibuja un QR como SVG (nítido a cualquier tamaño y sin lienzo ni imágenes).
 * El SVG se puede descargar como archivo y mandar a imprimir tal cual.
 */
const QUIET_ZONE = 4; // módulos de margen: sin esto muchos lectores fallan

export function QrCode({ value, size = 220, label = 'Código QR', className = '' }) {
    const matrix = useMemo(() => {
        try {
            return qrMatrix(value);
        } catch {
            return null;
        }
    }, [value]);

    if (!matrix) return null;
    const count = matrix.length;
    const total = count + QUIET_ZONE * 2;
    const path = matrix
        .map((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : '')).join(''))
        .join('');

    return (
        <svg
            role="img"
            aria-label={label}
            viewBox={`0 0 ${total} ${total}`}
            width={size}
            height={size}
            shapeRendering="crispEdges"
            className={className}
            data-testid="table-qr-svg"
        >
            <rect width={total} height={total} fill="#ffffff" />
            <path d={path} fill="#000000" />
        </svg>
    );
}

/**
 * Serializa el QR a un SVG suelto para descargarlo o imprimirlo.
 */
export function qrSvgMarkup(value, size = 512, label = 'Código QR') {
    const matrix = qrMatrix(value);
    const count = matrix.length;
    const total = count + QUIET_ZONE * 2;
    const path = matrix
        .map((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : '')).join(''))
        .join('');
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">`,
        `<title>${label}</title>`,
        `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
        `<path d="${path}" fill="#000000"/>`,
        '</svg>',
    ].join('');
}

function fileNameFor(name) {
    const safe = String(name || 'mesa').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return `qr-${safe || 'mesa'}.svg`;
}

/**
 * Botonera del QR: descargar, imprimir y copiar el enlace.
 */
export function QrActions({ value, name, url, disabled = false }) {
    const [status, setStatus] = useState('');
    const printRef = useRef(null);

    useEffect(() => () => {
        if (printRef.current?.parentNode) printRef.current.parentNode.removeChild(printRef.current);
    }, []);

    const download = () => {
        try {
            const blob = new Blob([qrSvgMarkup(value, 512, `QR ${name}`)], { type: 'image/svg+xml' });
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = fileNameFor(name);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
            setStatus('QR descargado.');
        } catch {
            setStatus('No se pudo descargar el QR.');
        }
    };

    const print = () => {
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);
        printRef.current = frame;
        const doc = frame.contentDocument;
        if (!doc) {
            setStatus('No se pudo preparar la impresión.');
            return;
        }
        doc.open();
        doc.write(`<!doctype html><html><head><title>QR ${name}</title>
            <style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif}
            h1{font-size:18px;margin:0 0 12px}p{font-size:12px;color:#444;margin:12px 0 0;word-break:break-all;max-width:90vw;text-align:center}</style>
            </head><body><h1>${name}</h1>${qrSvgMarkup(value, 420, `QR ${name}`)}
            <p>${url}</p></body></html>`);
        doc.close();
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setStatus('Listo para imprimir.');
    };

    const copyUrl = async () => {
        try {
            await navigator.clipboard.writeText(url);
            setStatus('Enlace copiado.');
        } catch {
            setStatus('No se pudo copiar. Selecciona el enlace para copiarlo a mano.');
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={disabled} onClick={download} className="inline-flex h-11 items-center rounded-md border px-3 text-sm disabled:opacity-50" data-testid="mesa-qr-download">Descargar QR</button>
                <button type="button" disabled={disabled} onClick={print} className="inline-flex h-11 items-center rounded-md border px-3 text-sm disabled:opacity-50" data-testid="mesa-qr-print">Imprimir</button>
                <button type="button" disabled={disabled} onClick={copyUrl} className="inline-flex h-11 items-center rounded-md border px-3 text-sm disabled:opacity-50" data-testid="mesa-qr-copy-url">Copiar enlace</button>
            </div>
            {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
        </div>
    );
}

export default QrCode;
