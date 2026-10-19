import React, { useEffect, useState } from 'react';
import { PAYMENT_LABELS } from '@/lib/format';
import { getOrder } from '@/lib/api/orders';

/**
 * The proof image of an account that only knows it has one. `GET /orders` lists
 * carry `has_proof`, not the base64 (up to ~2.4 MB per order), so the image is
 * read from the order by id, once, when the account is shown.
 */
function useStoredProofImage(acct, skip) {
    const [stored, setStored] = useState({ id: null, url: null });
    const wanted = !skip && !acct.payment_proof_url && acct.has_proof === true;
    useEffect(() => {
        if (!wanted) return undefined;
        let active = true;
        getOrder(acct.id)
            .then(({ data }) => { if (active) setStored({ id: acct.id, url: data?.payment_proof_url || null }); })
            .catch(() => { /* the status text still says a proof is pending */ });
        return () => { active = false; };
    }, [wanted, acct.id]);
    return stored.id === acct.id ? stored.url : null;
}

/**
 * Status of the proof already sent for this account.
 */
export default function ProofStatus({
    acct, proofIntent, proofRefreshError, proofRefreshPending,
    proofSent, retryOrderRefresh,
}) {
    const storedImage = useStoredProofImage(acct, Boolean(proofIntent?.payment_proof));
    const proofImage = proofIntent?.payment_proof || acct.payment_proof_url || storedImage;
    return (
        <>
            {(acct.payment_status === 'comprobante_subido' || proofSent) && (
                <div className="proof-section" data-testid="caja-comprobante-pendiente">
                    <p className="proof-state" data-testid="caja-comprobante-enviado">
                        Comprobante {proofSent ? 'enviado' : 'pendiente'} para {PAYMENT_LABELS[proofIntent?.method || acct.payment_proof_method] || 'Yape o Plin'}; está pendiente de verificación.
                    </p>
                    {proofImage && (
                        <img src={proofImage} alt="Comprobante enviado" className="proof-thumbnail" />
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
