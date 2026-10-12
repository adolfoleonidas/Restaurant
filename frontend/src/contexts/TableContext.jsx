import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getPublicTableSession } from '@/lib/api/public';

/**
 * Contexto del QR de mesa.
 *
 * El QR entrega una capacidad firmada (`mesa=<token>`) y nada más: no crea
 * pedidos ni reserva la mesa. Este contexto la recuerda entre pantallas para que
 * el menú, el carrito y el checkout sepan desde dónde está pidiendo el cliente.
 *
 * El contexto es una preselección, no una cárcel: el cliente puede cambiar de
 * modalidad o de mesa, y ese cambio se resuelve en el checkout.
 */
const STORAGE_KEY = 'public_table_ctx_v1';

// Sin proveedor (una pantalla montada sola en una prueba, por ejemplo) el
// contexto queda vacío en vez de romper el render.
const EMPTY_CONTEXT = {
    token: '',
    table: null,
    session: null,
    policy: null,
    hasTable: false,
    loading: false,
    error: '',
    refresh: async () => null,
    clearTable: () => {},
};

const TableContext = createContext(null);

function readStored() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeStored(value) {
    try {
        if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* modo privado: el contexto vive solo en memoria */ }
}

export const TableProvider = ({ children }) => {
    // Se lee la URL directamente para no depender del router: así el proveedor
    // se puede montar en cualquier orden y las pantallas siguen siendo testeables.
    const location = useLocation();
    const urlToken = useMemo(() => {
        try {
            return new URLSearchParams(location.search).get('mesa') || '';
        } catch {
            return '';
        }
    }, [location.search]);
    const [state, setState] = useState(() => readStored());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // El token de la URL manda y queda guardado: el cliente puede navegar a una
    // categoría o al carrito y el contexto no se pierde.
    useEffect(() => {
        if (!urlToken) return;
        if (state?.token === urlToken) return;
        setState({ token: urlToken, table: null, session: null, policy: null });
        writeStored({ token: urlToken, table: null, session: null, policy: null });
    }, [urlToken, state?.token]);

    const token = urlToken || state?.token || '';

    useEffect(() => {
        if (!token) return undefined;
        let active = true;
        setLoading(true);
        setError('');
        getPublicTableSession(token)
            .then((response) => {
                if (!active) return;
                // Un QR impreso no vence solo: si el servidor lo renovó, se guarda
                // el enlace nuevo para no volver a pedirlo en cada pantalla.
                const next = { token: response.data?.renewed_token || token, ...response.data };
                setState(next);
                writeStored(next);
            })
            .catch((requestError) => {
                if (!active) return;
                // Un QR revocado o rotado deja de servir: se avisa y se olvida.
                setError(requestError.response?.data?.detail || 'No pudimos leer el QR de la mesa.');
                setState({ token, table: null, session: null, policy: null });
                writeStored(null);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const refresh = useCallback(async () => {
        if (!token) return null;
        const response = await getPublicTableSession(token);
        const next = { token: response.data?.renewed_token || token, ...response.data };
        setState(next);
        writeStored(next);
        return next;
    }, [token]);

    const clearTable = useCallback(() => {
        setState(null);
        writeStored(null);
    }, []);

    const value = useMemo(() => ({
        token,
        table: state?.table || null,
        session: state?.session || null,
        policy: state?.policy || null,
        hasTable: Boolean(token && state?.table),
        loading,
        error,
        refresh,
        clearTable,
    }), [token, state, loading, error, refresh, clearTable]);

    return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
};

export const useTableContext = () => useContext(TableContext) || EMPTY_CONTEXT;
