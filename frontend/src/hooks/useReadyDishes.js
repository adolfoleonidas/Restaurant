import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';

/**
 * Platos listos para servir en el piso, para el badge de la navegación.
 *
 * Es la misma métrica y la misma fuente que el resumen del Salón ("Listos: N"):
 * suma las cantidades de items con estado `listo` de los pedidos activos. El
 * shell se monta una sola vez por sesión, así que un poll de 25 s actualiza el
 * badge sin competir con el de las pantallas; se apaga para los roles que no
 * tienen Salón en su navegación.
 */
export function readyDishes(orders = []) {
    let ready = 0;
    for (const order of orders || []) {
        for (const item of order?.items || []) {
            if (item.status === 'listo') ready += Number(item.quantity || 0);
        }
    }
    return ready;
}

export default function useReadyDishes(enabled = true) {
    const { data } = usePolling(
        () => (enabled
            ? api.get('/orders', { params: { active_only: true } }).then((r) => r.data)
            : Promise.resolve(null)),
        25000,
        [enabled]
    );
    if (!enabled || !Array.isArray(data)) return 0;
    return readyDishes(data);
}
