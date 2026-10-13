import { useMemo } from 'react';
import usePolling from '@/hooks/usePolling';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';
import { listTables } from '@/lib/api/tables';
import { listOrders } from '@/lib/api/orders';
import { listProducts } from '@/lib/api/products';
import { listCategories } from '@/lib/api/categories';

/** Everything the Salón polls: the floor, the live orders and the menu. */
export default function useSalonData({
    isOwner, scope, scopeKey, scopeParams, scopePending,
}) {
    // Each query refetches only for the realtime topics it renders. `/tables`
    // embeds every table's open orders (`active_order`), so it follows both.
    const tablesGeneration = useRealtimeGeneration(['tables', 'orders']);
    const floorGeneration = useRealtimeGeneration(['tables']);
    const ordersGeneration = useRealtimeGeneration(['orders']);
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
