import React from 'react';
import { PAYMENT_LABELS } from '@/lib/format';
import { X } from 'lucide-react';

/**
 * Enlarged QR for the customer.
 */
export default function QrDialog({
    backendMethod, setShowQr, walletConfig,
}) {
    return (
        <div className="cobro-sub-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowQr(false); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="qr-title" className="cobro-subdialog">
                <header className="dialog-header">
                    <h2 id="qr-title">Código para mostrar al cliente</h2>
                    <button className="icon-button" onClick={() => setShowQr(false)} aria-label="Cerrar QR">
                        <X style={{ width: 20, height: 20 }} />
                    </button>
                </header>
                <div className="dialog-body">
                    <img className="qr-large" src={walletConfig.qr} alt={`Código QR de ${PAYMENT_LABELS[backendMethod]} ampliado`} />
                    {walletConfig.holder && <p className="qr-dialog-label">{walletConfig.holder}</p>}
                    {walletConfig.number && <p className="qr-dialog-number amount">{walletConfig.number}</p>}
                </div>
            </div>
        </div>
    );
}
