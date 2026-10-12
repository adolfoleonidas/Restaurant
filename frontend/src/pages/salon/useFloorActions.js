import { toast } from 'sonner';
import { closeOrderAttention, serveOrder, setOrderStatus } from '@/lib/api/orders';
import { releaseTable as releaseTableRequest } from '@/lib/api/tables';
import usePendingAction from '@/hooks/usePendingAction';

/**
 * One-shot actions of the floor: deliver, close a visit, ask for the bill, free a table.
 *
 * Each runs through `usePendingAction`, so a repeat tap while the request is in
 * flight is ignored and `pending` tells the buttons which key to show as working
 * (`deliver:<orderId>`, `close:<orderId>`, `bill:<orderId>`, `release:<tableId>`).
 */
export default function useFloorActions({
    canTake, closeSheet, refreshAll, refetchTables, navigate,
}) {
    const [run, pending] = usePendingAction();
    const closingKey = [...pending].find((key) => key.startsWith('close:'));
    const closing = closingKey ? closingKey.slice('close:'.length) : null;

    // Charging leaves the floor: the cash screen owns the whole payment flow.
    const openCharge = (order) => {
        closeSheet();
        navigate(`/pedidos/${order.id}`);
    };

    const deliver = (orderId) => run(`deliver:${orderId}`, async () => {
        await serveOrder(orderId);
        toast.success('Pedido entregado');
        closeSheet();
        refreshAll();
    }, { errorMessage: 'No se pudo entregar' });

    const closeAttention = (order) => run(`close:${order.id}`, async () => {
        await closeOrderAttention(order.id);
        toast.success('Atención cerrada');
        closeSheet();
        refreshAll();
    }, {
        errorMessage: 'No se pudo cerrar la atención. Puedes reintentar.',
        onError: () => refreshAll(),
    });

    const requestBill = (order) => run(`bill:${order.id}`, async () => {
        await setOrderStatus(order.id, { status: 'pendiente_pago' });
        toast.success('Cuenta solicitada');
        closeSheet();
        refreshAll();
    }, { errorMessage: 'No se pudo solicitar la cuenta' });

    const releaseTable = (t) => {
        if (!canTake) return undefined;
        return run(`release:${t.id}`, async () => {
            await releaseTableRequest(t.id);
            toast.success(`Mesa ${t.number} libre`);
            closeSheet();
            refetchTables?.();
        }, { errorMessage: 'No se pudo liberar' });
    };

    return {
        closing, pending, openCharge, deliver, closeAttention, requestBill, releaseTable,
    };
}
