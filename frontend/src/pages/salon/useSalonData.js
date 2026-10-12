import { useMemo } from 'react';
import usePolling from '@/hooks/usePolling';
import { listTables } from '@/lib/api/tables';
import { listOrders } from '@/lib/api/orders';
import { listProducts } from '@/lib/api/products';
import { listCategories } from '@/lib/api/categories';

/** Everything the Salón polls: the floor, the live orders and the menu. */
export default function useSalonData({
    generation, isOwner, scope, scopeKey, scopeParams, scopePending,
}) {
    const {
        data: tables, error: tablesError, loading: tablesLoading, refetch: refetchTables,
    } = usePolling(
        // Sin sucursal elegida el pedido va sin parámetros: el servidor ya acota
        // a la sucursal del usuario.
        () => (scopePending
            ? Promise.resolve(null)
            : listTables(scopeParams)).then((r) => (r ? r.data : null)),
        8000,
        [generation, scopeKey, scopePending]
    );
    const { data: liveOrders, error: ordersError, refetch: refetchOrders } = usePolling(
        () => (scopePending
            ? Promise.resolve(null)
            : listOrders({ active_only: true, ...scopeParams })).then((r) => (r ? r.data : null)),
        8000,
        [generation, scopeKey, scopePending]
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
        [generation, isOwner, scopeKey, scopePending]
    );
    const unassignedCount = Array.isArray(unassigned) ? unassigned.length : 0;

    // Carta para componer el pedido sin salir del salón.
    const { data: liveProducts } = usePolling(() => listProducts().then((r) => r.data), 60000, [generation]);
    const { data: liveCategories } = usePolling(() => listCategories().then((r) => r.data), 60000);
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
