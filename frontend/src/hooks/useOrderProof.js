import { useState } from 'react';
import { toast } from 'sonner';
import { getOrder } from '@/lib/api/orders';

/**
 * Opens the payment proof image of an order for the cashier: web orders and
 * prepay checks both read it from the order detail.
 *
 * `scopeParams` (branch scope of the owner) is sent only when it has keys.
 */
export default function useOrderProof(scopeParams = {}) {
    const [proof, setProof] = useState(null);
    const [loading, setLoading] = useState(false);

    const openProof = async (order) => {
        setLoading(true);
        try {
            const options = Object.keys(scopeParams).length ? { params: scopeParams } : undefined;
            const { data } = await getOrder(order.id, options);
            setProof({ order, url: data.payment_proof_url || null });
        } catch {
            toast.error('No se pudo cargar el comprobante');
        } finally {
            setLoading(false);
        }
    };

    const closeProof = () => setProof(null);

    return {
        proof, loading, openProof, closeProof,
    };
}
