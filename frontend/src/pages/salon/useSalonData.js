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
    // Cada tanda de toques que el mozo guarda publica un evento `orders` (ver
    // `sync_draft_lines`). En ESTE dispositivo ese evento no trae nada: la
    // escritura ya volvió con el pedido entero (ver `useOrderLineSync`) y los
    // caminos que sí cambian el piso —abrir una cuenta, enviar a cocina, anular,
    // mover, cerrar— lo refrescan a propósito. Sin esto, cada pausa del mozo se
    // bajaba la lista de mesas (~60 KB medidos con 60 mesas y 20 cuentas) y la de
    // pedidos para no ver nada nuevo.
    //
    // Se salta sólo eso: el eco de las líneas de borrador de este mismo usuario.
    // Todo lo demás sigue refrescando, y un evento sin actor es de otro o de una
    // versión anterior a este cambio: se refresca.
    const ownDraftEcho = (event) => event?.extra === 'draft_lines' && event.actor_user_id === user?.id;
    const somebodyElse = (event) => !ownDraftEcho(event);
    // Each query refetches only for the realtime topics it renders. `/tables`
    // embeds every table's open orders (`active_order`), so it follows both.
    const tablesGeneration = useRealtimeGeneration(['tables', 'orders'], somebodyElse);
    const floorGeneration = useRealtimeGeneration(['tables'], somebodyElse);
    const ordersGeneration = useRealtimeGeneration(['orders'], somebodyElse);
    const catalogGeneration = useRealtimeGeneration(['catalog']);
    const {
        data: tables, error: tablesError, loading: tablesLoading, refetch: refetchTables,
    } = usePolling(
        // Sin sucursal elegida el pedido va sin parámetros: el servidor ya acota
        // a la sucursal del usuario.
        () => (scopePending
            ? Promise.resolve(null)
            : listTables(scopeParams)).then((r) => (r ? r.data : null)),
        8000,
        [tablesGeneration, scopeKey, scopePending]
    );
    const { data: liveOrders, error: ordersError, refetch: refetchOrders } = usePolling(
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
    };
}
