import React, { useEffect, useRef, useState } from 'react';
import { getTableGuestLink, revokeTableQr, rotateTableQr } from '@/lib/api/tables';
import { Button } from '@/components/ui/button';
import QrCode, { QrActions } from '@/components/TableQr';
import { apiErrorMessage } from '@/lib/apiError';

// El QR abre la carta con la mesa en contexto. Antes llevaba al checkout, así
// que el cliente caía en una pantalla de pago sin haber elegido nada.
const MENU_PATH = '/menu';

export function buildGuestUrl(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Enlace no válido');
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== MENU_PATH || !url.searchParams.get('mesa')) {
        throw new Error('Enlace no válido');
    }
    return url.toString();
}

const statusLabels = {
    active: 'QR activo',
    revoked: 'QR revocado',
    none: 'Sin QR',
    unknown: 'Estado no confirmado',
};

export default function TableQrActions({ table }) {
    const [status, setStatus] = useState(table.qr_status || 'none');
    const [guestUrl, setGuestUrl] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [copyFallback, setCopyFallback] = useState(false);
    const urlRef = useRef(null);

    useEffect(() => {
        setStatus(table.qr_status || 'none');
        setGuestUrl('');
        setBusy('');
        setError('');
        setCopyFallback(false);
    }, [table.id, table.qr_status]);

    const updateStatus = (nextStatus) => {
        setStatus(nextStatus);
    };

    const getGuestLink = async () => {
        setBusy('link');
        setError('');
        setGuestUrl('');
        setCopyFallback(false);
        try {
            const { data } = await getTableGuestLink(table.id);
            setGuestUrl(buildGuestUrl(data?.path));
            updateStatus('active');
        } catch (requestError) {
            updateStatus(requestError.response?.status === 400 ? 'revoked' : 'unknown');
            setError(apiErrorMessage(requestError, 'No se pudo obtener el enlace. Inténtelo nuevamente.'));
        } finally {
            setBusy('');
        }
    };

    const rotateQr = async () => {
        if (!window.confirm(`¿Regenerar el acceso QR de ${table.name}? El enlace anterior dejará de funcionar y habrá que reimprimir el cartel.`)) return;
        setGuestUrl('');
        setCopyFallback(false);
        setError('');
        setStatus('unknown');
        setBusy('rotate');
        try {
            const { data } = await rotateTableQr(table.id);
            setGuestUrl(buildGuestUrl(data?.path));
            updateStatus('active');
        } catch (requestError) {
            setError(apiErrorMessage(requestError, 'No se pudo confirmar la regeneración. Vuelva a cargar la mesa.'));
        } finally {
            setBusy('');
        }
    };

    const revokeQr = async () => {
        if (!window.confirm(`¿Revocar el acceso QR de ${table.name}? Los enlaces existentes dejarán de funcionar.`)) return;
        setGuestUrl('');
        setCopyFallback(false);
        setError('');
        setStatus('unknown');
        setBusy('revoke');
        try {
            const { data } = await revokeTableQr(table.id);
            if (data?.qr_status !== 'revoked') throw new Error('Revocation was not confirmed');
            updateStatus('revoked');
        } catch (requestError) {
            setError(apiErrorMessage(requestError, 'No se pudo confirmar la revocación. Vuelva a cargar la mesa.'));
        } finally {
            setBusy('');
        }
    };

    const copyLink = async () => {
        if (!guestUrl) return;
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
            await navigator.clipboard.writeText(guestUrl);
            setCopyFallback(false);
            setError('Enlace copiado.');
        } catch {
            setCopyFallback(true);
            setError('No se pudo copiar automáticamente. Seleccione el enlace para copiarlo manualmente.');
            urlRef.current?.focus();
            urlRef.current?.select();
        }
    };

    const label = statusLabels[status] || statusLabels.unknown;

    return (
        <div className="mt-3 space-y-2 border-t pt-3" data-testid={`mesa-qr-controls-${table.id}`}>
            <p className="text-xs text-muted-foreground" data-testid={`mesa-qr-status-${table.id}`}>{label}</p>
            <div className="flex flex-wrap gap-2">
                {status !== 'revoked' && (
                    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={getGuestLink} data-testid={`mesa-qr-link-${table.id}`}>
                        {busy === 'link' ? 'Obteniendo enlace…' : guestUrl ? 'Actualizar enlace' : status === 'active' ? 'Ver QR y enlace' : 'Generar QR y enlace'}
                    </Button>
                )}
                {(status === 'active' || status === 'revoked') && (
                    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={rotateQr} data-testid={`mesa-qr-rotate-${table.id}`}>
                        {busy === 'rotate' ? 'Regenerando…' : 'Regenerar QR'}
                    </Button>
                )}
                {status === 'active' && (
                    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={revokeQr} data-testid={`mesa-qr-revoke-${table.id}`}>
                        {busy === 'revoke' ? 'Revocando…' : 'Revocar QR'}
                    </Button>
                )}
            </div>
            {guestUrl && (
                <div className="space-y-3" data-testid={`mesa-qr-link-view-${table.id}`}>
                    <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-3 sm:flex-row sm:items-start">
                        <QrCode value={guestUrl} size={168} label={`QR de ${table.name}`} />
                        <div className="min-w-0 flex-1 space-y-2">
                            <p className="text-xs text-muted-foreground">
                                Imprimí este código y pegalo en {table.name}. El cliente lo escanea, ve la carta y pide desde ahí.
                            </p>
                            <input
                                ref={urlRef}
                                type="text"
                                readOnly
                                value={guestUrl}
                                aria-label={`Enlace QR de ${table.name}`}
                                className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                                data-testid={`mesa-qr-url-${table.id}`}
                                onFocus={(event) => event.target.select()}
                            />
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={copyLink} disabled={!!busy} data-testid={`mesa-qr-copy-${table.id}`}>Copiar enlace</Button>
                                <a className="inline-flex h-9 items-center rounded-md border px-3 text-sm" href={guestUrl} target="_blank" rel="noopener noreferrer" data-testid={`mesa-qr-open-${table.id}`}>Abrir enlace</a>
                            </div>
                        </div>
                    </div>
                    <QrActions value={guestUrl} name={table.name} url={guestUrl} disabled={!!busy} />
                    {copyFallback && <p className="text-xs text-muted-foreground" data-testid={`mesa-qr-copy-fallback-${table.id}`}>El enlace permanece visible para copiarlo manualmente.</p>}
                </div>
            )}
            {error && <p role="status" className="text-xs text-muted-foreground" data-testid={`mesa-qr-error-${table.id}`}>{error}</p>}
        </div>
    );
}
