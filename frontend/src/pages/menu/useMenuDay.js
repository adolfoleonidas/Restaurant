import { useCallback, useEffect, useState } from 'react';

import { copyMenuFrom, getMenuDay, saveMenuDay, setMenuSoldOut } from '@/lib/api/menu';
import { apiErrorMessage } from '@/lib/apiError';

/**
 * El estado de la pantalla «Hoy»: leer el día, guardar, publicar, agotar y
 * copiar de otra fecha.
 *
 * Cada mutación devuelve el día ya resuelto por el servidor, y se usa esa
 * respuesta en vez de recomponer el estado a mano: el servidor es quien sabe qué
 * queda ofrecido de verdad (carta fija, agotados, precio del día), y adivinarlo
 * aquí sería tener dos verdades que se separan al primer caso raro.
 */
export default function useMenuDay(date) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: payload } = await getMenuDay(date);
            setData(payload);
        } catch (e) {
            setError(apiErrorMessage(e, 'No se pudo cargar el menú'));
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => { load(); }, [load]);

    /** Guarda la selección. `publish` en falso deja borrador y **no** toca la carta. */
    const save = useCallback(async (items, publish = false) => {
        setSaving(true);
        try {
            const { data: payload } = await saveMenuDay({ date, items, publish });
            setData((current) => ({ ...current, ...payload }));
            return payload;
        } finally {
            setSaving(false);
        }
    }, [date]);

    /** Agotar es inmediato: no espera a publicar. */
    const toggleSoldOut = useCallback(async (productId, soldOut = true) => {
        await setMenuSoldOut({ date, product_id: productId, sold_out: soldOut });
        await load();
    }, [date, load]);

    /** Trae los platos de otro día; el servidor los deja en borrador. */
    const copyFrom = useCallback(async (fromDate) => {
        setSaving(true);
        try {
            const { data: payload } = await copyMenuFrom({ date, from_date: fromDate });
            setData((current) => ({ ...current, ...payload }));
            return payload;
        } finally {
            setSaving(false);
        }
    }, [date]);

    return { data, loading, error, saving, reload: load, save, toggleSoldOut, copyFrom };
}
