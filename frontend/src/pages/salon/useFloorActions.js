import { useState } from 'react';
import { toast } from 'sonner';
import { closeOrderAttention, serveOrder, setOrderStatus } from '@/lib/api/orders';
import { releaseTable as releaseTableRequest } from '@/lib/api/tables';

/** One-shot actions of the floor: deliver, close a visit, ask for the bill, free a table. */
export default function useFloorActions({
    canTake, closeSheet, refreshAll, refetchTables, navigate,
}) {
    const [closing, setClosing] = useState(null);

    // Charging leaves the floor: the cash screen owns the whole payment flow.
    const openCharge = (order) => {
        closeSheet();
        navigate(`/pedidos/${order.id}`);
    };

    const deliver = async (orderId) => {
        try {
            await serveOrder(orderId);
            toast.success('Pedido entregado');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo entregar');
        }
    };

    const closeAttention = async (order) => {
        setClosing(order.id);
        try {
            await closeOrderAttention(order.id);
            toast.success('Atención cerrada');
            closeSheet();
            refreshAll();
        } catch (e) {
            refreshAll();
            toast.error(e.response?.data?.detail || 'No se pudo cerrar la atención. Puedes reintentar.');
        } finally {
            setClosing(null);
        }
    };

    const requestBill = async (order) => {
        try {
            await setOrderStatus(order.id, { status: 'pendiente_pago' });
            toast.success('Cuenta solicitada');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo solicitar la cuenta');
        }
    };

    const releaseTable = async (t) => {
        if (!canTake) return;
        try {
            await releaseTableRequest(t.id);
            toast.success(`Mesa ${t.number} libre`);
            closeSheet();
            refetchTables?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo liberar');
        }
    };

    return {
        closing, openCharge, deliver, closeAttention, requestBill, releaseTable,
    };
}
