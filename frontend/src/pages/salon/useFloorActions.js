import { toast } from 'sonner';
import { closeOrderAttention, serveOrder, setOrderStatus } from '@/lib/api/orders';
import { releaseTable as releaseTableRequest } from '@/lib/api/tables';
import usePendingAction from '@/hooks/usePendingAction';

/**
 * Lo que el servidor va a dejar en el pedido al servir: espejo de
 * `ticket_fields(o, "entregado", ...)` del backend. Los platos listos pasan a
 * entregados y el pedido queda «entregado» —o «pagado» si el cobro ya estaba
 * completo—.
 *
 * Se pinta al toque para que la tarjeta cambie en el sitio. Sin esto el parche
 * solo movía los platos, así que el estado de la mesa seguía diciendo «Listo»
 * hasta el siguiente sondeo (8 s) y el mozo volvía a tocar un botón que ya estaba
 * deshabilitado, o abría el pedido para comprobar que sí había pasado algo.
 */
export function servedOrderPatch(order) {
    const items = (order.items || []).map((item) => (
        item.status === 'listo' ? { ...item, status: 'entregado' } : item
    ));
    const paid = Number(order.amount_paid || 0);
    const total = Number(order.total || 0);
    const settled = order.payment_status === 'pagado' && paid + 0.009 >= total;
    return { items, fulfillment_status: 'entregado', status: settled ? 'pagado' : 'entregado' };
}

/**
 * One-shot actions of the floor: deliver, close a visit, ask for the bill, free a table.
 *
 * Each runs through `usePendingAction`, so a repeat tap while the request is in
 * flight is ignored and `pending` tells the buttons which key to show as working
 * (`deliver:<orderId>`, `close:<orderId>`, `bill:<orderId>`, `release:<tableId>`).
 */
export default function useFloorActions({
    canTake, canUseCaja, closeSheet, refreshAll, refetchTables, navigate, patchOrder,
}) {
    const [run, pending] = usePendingAction();
    const closingKey = [...pending].find((key) => key.startsWith('close:'));
    const closing = closingKey ? closingKey.slice('close:'.length) : null;

    /**
     * Cobrar lleva a cobrar.
     *
     * La caja es la pantalla que cobra —turno, medios de pago, comprobantes,
     * descuentos y anulaciones— y acepta la cuenta por `?order=`, el mismo
     * enlace que ya usaba el detalle del pedido cuando no hay turno abierto.
     *
     * Antes esto abría `/pedidos/:id`, que es el detalle del pedido *con
     * tomador*: el mozo pedía cobrar y aterrizaba en la carta, con el botón de
     * cobro al final de un scroll largo. Agregar un plato antes de cobrar ya se
     * puede desde la hoja de la mesa, así que no se pierde nada.
     */
    const openCharge = (order) => {
        closeSheet();
        if (canUseCaja) {
            navigate(`/caja?order=${order.id}`);
            return;
        }
        // Sin acceso a Caja: no debería ocurrir, porque `salon.charge` exige la
        // función de cobro y eso abre la ruta (ver `permissions.test.js`). Si
        // alguna vez dejara de cumplirse, el detalle del pedido sabe cobrar.
        navigate(`/pedidos/${order.id}`);
    };

    // Entregar son dos viajes: el POST y el refresco de las listas. La tarjeta se
    // pinta al toque con lo que el servidor va a confirmar —platos **y** estado—,
    // y el refresco la corrige. Sin esto, entre el toque y el cambio pasaba más de
    // un segundo y el mozo creía que el botón no funcionaba (volvía a tocar y ya
    // estaba deshabilitado).
    const deliver = (orderId) => run(`deliver:${orderId}`, async () => {
        patchOrder?.(orderId, servedOrderPatch);
        try {
            await serveOrder(orderId);
        } catch (error) {
            // Falló: lo pintado se descarta y la pantalla vuelve a lo del servidor.
            refreshAll();
            throw error;
        }
        toast.success('Pedido entregado');
        closeSheet();
        refreshAll();
    }, { errorMessage: 'No se pudo entregar', onError: () => refreshAll() });

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
