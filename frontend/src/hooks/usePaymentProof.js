import { useEffect, useRef, useState } from 'react';
import { getOrder } from '@/lib/api/orders';
import { getCollectionConfig, uploadPaymentProof } from '@/lib/api/payments';

/**
 * Wallet proof flow of the charge dialog: the receiving accounts, the image the
 * cashier picked, the upload (retryable with the very same image) and the
 * refresh of the account afterwards.
 *
 * `resetProof` / `invalidateProof` advance an epoch so a late response from a
 * previous account can never land on the next one.
 */
export default function usePaymentProof({
    open, canSubmitProof, restaurantId, acct, backendMethod, onOrderRefreshed,
}) {
    const [collectionConfig, setCollectionConfig] = useState(null);
    const [collectionConfigError, setCollectionConfigError] = useState(false);
    const [selectedProof, setSelectedProof] = useState('');
    const [proofIntent, setProofIntent] = useState(null);
    const [proofSending, setProofSending] = useState(false);
    const [proofSent, setProofSent] = useState(false);
    const [proofError, setProofError] = useState('');
    const [proofRefreshPending, setProofRefreshPending] = useState(false);
    const [proofRefreshError, setProofRefreshError] = useState('');
    const dialogEpochRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        setCollectionConfig(null);
        setCollectionConfigError(false);
        if (!open || !canSubmitProof) return () => { cancelled = true; };
        getCollectionConfig()
            .then(({ data }) => { if (!cancelled) setCollectionConfig(data || {}); })
            .catch(() => { if (!cancelled) setCollectionConfigError(true); });
        return () => { cancelled = true; };
    }, [open, canSubmitProof, restaurantId]);

    /** A new account opens: forget everything about the previous proof. */
    const resetProof = () => {
        dialogEpochRef.current += 1;
        setSelectedProof(''); setProofIntent(null); setProofSending(false); setProofSent(false); setProofError('');
        setProofRefreshPending(false); setProofRefreshError('');
    };

    /** The dialog closed: ignore any response still in flight. */
    const invalidateProof = () => { dialogEpochRef.current += 1; };

    const refreshOrderAfterProof = async (orderId, requestEpoch) => {
        try {
            const { data } = await getOrder(orderId);
            if (dialogEpochRef.current !== requestEpoch || !open) return false;
            if (!data || data.id !== orderId) throw new Error('Invalid order response');
            onOrderRefreshed(data);
            setProofRefreshPending(false);
            setProofRefreshError('');
            return true;
        } catch {
            if (dialogEpochRef.current === requestEpoch && open) {
                setProofRefreshPending(true);
                setProofRefreshError('El comprobante fue recibido, pero no se pudo actualizar la cuenta. Recargue antes de registrar un pago.');
            }
            return false;
        }
    };

    const submitProof = async () => {
        if (!canSubmitProof || proofSending || proofSent) return;
        const intent = proofIntent || { orderId: acct.id, method: backendMethod, payment_proof: selectedProof };
        if (!intent.payment_proof || !collectionConfig?.[intent.method]?.enabled) return;
        const requestEpoch = dialogEpochRef.current;
        const requestOrderId = intent.orderId;
        setProofIntent(intent);
        setProofSending(true);
        setProofError('');
        try {
            await uploadPaymentProof(requestOrderId, {
                method: intent.method,
                payment_proof: intent.payment_proof,
            });
            if (dialogEpochRef.current !== requestEpoch || !open) return;
            setProofSent(true);
            setProofRefreshPending(true);
            await refreshOrderAfterProof(requestOrderId, requestEpoch);
        } catch (error) {
            if (dialogEpochRef.current !== requestEpoch || !open) return;
            const detail = error.response?.data?.detail;
            setProofError(typeof detail === 'string' ? detail : 'No se pudo enviar el comprobante. Puede reintentar la misma imagen.');
        } finally {
            if (dialogEpochRef.current === requestEpoch && open) setProofSending(false);
        }
    };

    const retryOrderRefresh = () => refreshOrderAfterProof(proofIntent?.orderId || acct.id, dialogEpochRef.current);

    return {
        collectionConfig,
        collectionConfigError,
        selectedProof,
        setSelectedProof,
        proofIntent,
        proofSending,
        proofSent,
        proofError,
        proofRefreshPending,
        proofRefreshError,
        resetProof,
        invalidateProof,
        submitProof,
        retryOrderRefresh,
    };
}
