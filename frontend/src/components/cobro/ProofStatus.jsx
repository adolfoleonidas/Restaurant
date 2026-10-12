import React from 'react';
import { PAYMENT_LABELS } from '@/lib/format';

/**
 * Status of the proof already sent for this account.
 */
export default function ProofStatus({
    acct, proofIntent, proofRefreshError, proofRefreshPending,
    proofSent, retryOrderRefresh,
}) {
    return (
        <>
            {(acct.payment_status === 'comprobante_subido' || proofSent) && (
                <div className="proof-section" data-testid="caja-comprobante-pendiente">
                    <p className="proof-state" data-testid="caja-comprobante-enviado">
                        Comprobante {proofSent ? 'enviado' : 'pendiente'} para {PAYMENT_LABELS[proofIntent?.method || acct.payment_proof_method] || 'Yape o Plin'}; está pendiente de verificación.
                    </p>
                    {(proofIntent?.payment_proof || acct.payment_proof_url) && (
                        <img src={proofIntent?.payment_proof || acct.payment_proof_url} alt="Comprobante enviado" className="proof-thumbnail" />
                    )}
                    {proofRefreshPending && (
                        <div>
                            <p role="alert" className="stale-error">{proofRefreshError}</p>
                            <button type="button" className="secondary-button" onClick={retryOrderRefresh} data-testid="caja-recargar-orden">Actualizar cuenta</button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
