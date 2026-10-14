import { useMemo } from 'react';
import usePolling from '@/hooks/usePolling';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';
import { listTables } from '@/lib/api/tables';
import { listOrders } from '@/lib/api/orders';
import { listProducts } from '@/lib/api/products';
import { listCategories } from '@/lib/api/categories';

/** Everything the Salón polls: the floor, the live orders and the menu. */
export default function useSalonData({
    isOwner, scope, scopeKey, scopeParams, scopePending,
}) {
    const { user } = useAuth();
    // Los cambios que ESTE usuario ya aplicó en su propia pantalla: la escritura
    // volvió con el pedido entero (ver `useOrderLineSync`) y el camino que lo hizo
    // —enviar a cocina, editar o anular líneas— refresca el piso a propósito. Pedir
    // otra vez las listas por el eco de uno mismo es lo que dejaba el enlace ocupado
    // justo cuando el mozo empieza el pedido siguiente: medido en su teléfono, unos
    // 600 ms de peticiones de más después de cada envío.
    //
    // No se salta todo lo propio: un cambio de mesa, de cuenta, un cobro, mover o
    // cerrar siguen refrescando, porque ahí el estado local no alcanza para saber
    // cómo quedó el piso. Y un evento sin actor es de otro o de una versión anterior
    // a este cambio: se refresca.
    const SELF_APPLIED = new Set([
        'draft_lines', 'items_added', 'item_removed', 'item_updated', 'item_voided', 'send_to_kitchen',
    ]);
    const ownApplied = (event) => SELF_APPLIED.has(event?.extra) && event.actor_user_id === user?.id;
    const somebodyElse = (event) => !ownApplied(event);
    // Each query refetches only for the realtime topics it renders. `/tables`
    // embeds every table's open orders (`active_order`), so it follows both.
    const tablesGeneration = useRealtimeGeneration(['tables', 'orders'], somebodyElse);
    const floorGeneration = useRealtimeGeneration(['tables'], somebodyElse);
    const ordersGeneration = useRealtimeGeneration(['orders'], somebodyElse);
    const catalogGeneration = useRealtimeGeneration(['catalog']);
    const {
        data: tables, error: tablesError, loading: tablesLoading, refetch: refetchTables, patch: patchTables,
    } = usePolling(
        // Sin sucursal elegida el pedido va sin parámetros: el servidor ya acota
        // a la sucursal del usuario.
        () => (scopePending
            ? Promise.resolve(null)
            : listTables(scopeParams)).then((r) => (r ? r.data : null)),
        8000,
        [tablesGeneration, scopeKey, scopePending]
    );
    const { data: liveOrders, error: ordersError, refetch: refetchOrders, patch: patchOrders } = usePolling(
        () => (scopePending
            ? Promise.resolve(null)
            : listOrders({ active_only: true, ...scopeParams })).then((r) => (r ? r.data : null)),
        8000,
        [ordersGeneration, scopeKey, scopePending]
    );
    const orders = useMemo(() => (Array.isArray(liveOrders) ? liveOrders : []), [liveOrders]);

    // Mesas que ningún salón muestra porque no tienen sucursal guardada. Es una
    // lectura de administración y a un ritmo más lento: sirve para avisar, no
    // para operar el piso.
    const { data: unassigned } = usePolling(
        () => (isOwner && !scopePending && scope !== 'legacy'
            ? listTables({ legacy_only: true }).then((r) => r.data)
            : Promise.resolve(null)),
        30000,
        [floorGeneration, isOwner, scopeKey, scopePending]
    );
    const unassignedCount = Array.isArray(unassigned) ? unassigned.length : 0;

    // Menu used to compose an order without leaving the floor. It follows only
    // the `catalog` topic: a waiter's taps (order events) never refetch it, while
    // a menu or availability change arrives without waiting for the slow poll.
    const { data: liveProducts } = usePolling(() => listProducts().then((r) => r.data), 60000, [catalogGeneration]);
    const { data: liveCategories } = usePolling(() => listCategories().then((r) => r.data), 60000, [catalogGeneration]);
    const products = useMemo(() => (Array.isArray(liveProducts) ? liveProducts : []), [liveProducts]);
    const categories = useMemo(() => (Array.isArray(liveCategories) ? liveCategories : []), [liveCategories]);

    const refreshAll = () => { refetchTables?.(); refetchOrders?.(); };

    /**
     * Cambia un pedido en pantalla YA, sin esperar a que vuelvan las listas.
     *
     * Lo usan las acciones del piso (entregar, cerrar la visita): son dos viajes —el
     * POST y el refresco— y hasta el segundo la tarjeta quedaba como estaba. Se toca
     * también el pedido embebido en su mesa (`active_order`), que es de donde la
     * tarjeta saca el estado. Si la acción falla, quien la llamó hace `refreshAll()`
     * y lo que se ve vuelve a ser lo del servidor.
     *
     * `change` es un objeto para reemplazar campos o una función `(order) => patch`.
     * La función devuelve el **parche**, no el pedido completo: se fusiona sobre el
     * pedido vivo. Antes se usaba tal cual como objeto nuevo, así que tras un
     * «Entregar» la tarjeta perdía `id`, `status` y `total` —el monto parpadeaba y
     * el estado caía a «Ocupada»— hasta que llegaba el refresco.
     */
    const patchOrder = (orderId, change) => {
        const apply = (order) => {
            if (!order || order.id !== orderId) return order;
            const fields = typeof change === 'function' ? change(order) : change;
            return fields ? { ...order, ...fields } : order;
        };
        patchOrders?.((list) => (Array.isArray(list) ? list.map(apply) : list));
        patchTables?.((list) => (Array.isArray(list)
            ? list.map((t) => (t.active_order ? { ...t, active_order: apply(t.active_order) } : t))
            : list));
    };

    return {
        tables,
        tablesError,
        tablesLoading,
        refetchTables,
        orders,
        ordersError,
        refetchOrders,
        unassignedCount,
        products,
        categories,
        refreshAll,
        patchOrder,
    };
}
