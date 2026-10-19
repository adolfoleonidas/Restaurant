import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { addPublicOrderItem, getPublicOrder, removePublicOrderItem, updatePublicOrderItem } from '@/lib/api/public';
import usePolling from '@/hooks/usePolling';
import usePublicStream from '@/hooks/usePublicStream';
import { apiErrorMessage } from '@/lib/apiError';

const KEY = 'public_last_order_v1';
const LiveOrderContext = createContext(null);

function loadMeta() {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export const LiveOrderProvider = ({ children }) => {
    const [meta, setMetaState] = useState(loadMeta);
    const [busy, setBusy] = useState({});
    const [mode, setMode] = useState('live');

    const setMeta = (m) => {
        try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
        setMetaState(m);
        setMode('live');
    };
    const clearMeta = () => {
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
        setMetaState(null);
        setMode('cart');
    };

    const fetcher = useCallback(() => {
        if (!meta?.tracking_code) return Promise.resolve(null);
        // Only a 404 means the order is gone. Any other failure (timeout, 429, 500,
        // network) is rethrown so usePolling keeps the last order it read.
        return getPublicOrder(meta.tracking_code).then((r) => r.data).catch((e) => {
            if (e.response?.status !== 404) throw e;
            clearMeta();
            return null;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meta?.tracking_code]);

    const { generation: streamGen } = usePublicStream({ trackingCode: meta?.tracking_code });

    const { data: order, refetch } = usePolling(fetcher, 10000, [meta?.tracking_code, streamGen]);

    useEffect(() => {
        if (order && ['pagado', 'cancelado'].includes(order.status)) clearMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order?.status]);

    const isActive = Boolean(order) && !['pagado', 'cancelado'].includes(order.status);

    const productQty = (productId) => (order?.items || [])
        .filter((i) => i.product_id === productId && i.status !== 'cancelado')
        .reduce((s, i) => s + (i.quantity || 0), 0);

    const statusCounts = (productId) => {
        const counts = { pendiente: 0, en_preparacion: 0, listo: 0, entregado: 0 };
        for (const i of order?.items || []) {
            if (i.product_id === productId && i.status !== 'cancelado' && i.status in counts) {
                counts[i.status] += (i.quantity || 0);
            }
        }
        return counts;
    };

    const addProduct = async (product, qty = 1) => {
        if (!order) return;
        setBusy((b) => ({ ...b, [product.id]: true }));
        try {
            await addPublicOrderItem(order.tracking_code, {
                items: [{ product_id: product.id, quantity: qty }],
            });
            await refetch();
        } catch (e) {
            throw new Error(apiErrorMessage(e, 'No se pudo actualizar el pedido'));
        } finally {
            setBusy((b) => ({ ...b, [product.id]: false }));
        }
    };

    const decrementLine = async (line) => {
        if (!order) return;
        if (line.status !== 'pendiente' && line.status != null) {
            throw new Error('Ese plato ya está en cocina. Consulta al mozo si quieres quitarlo.');
        }
        setBusy((b) => ({ ...b, [line.product_id]: true }));
        try {
            if (line.quantity > 1) {
                await updatePublicOrderItem(order.tracking_code, line.id, { quantity: line.quantity - 1 });
            } else {
                await removePublicOrderItem(order.tracking_code, line.id);
            }
            await refetch();
        } catch (e) {
            throw new Error(apiErrorMessage(e, 'No se pudo actualizar el pedido'));
        } finally {
            setBusy((b) => ({ ...b, [line.product_id]: false }));
        }
    };

    const decrementProduct = async (product) => {
        if (!order) return;
        const lines = (order.items || [])
            .filter((i) => i.product_id === product.id && (i.status === 'pendiente' || !i.status))
            .sort((a, b) => new Date(b.added_at || 0) - new Date(a.added_at || 0));
        const target = lines[0];
        if (!target) throw new Error('Ese plato ya está en preparación. Pide al mozo si quieres quitarlo.');
        return decrementLine(target);
    };

    return (
        <LiveOrderContext.Provider value={{
            meta, setMeta, clearMeta,
            order, isActive, refetch,
            mode, setMode,
            productQty, statusCounts, addProduct, decrementProduct, decrementLine, busy,
        }}>
            {children}
        </LiveOrderContext.Provider>
    );
};

export const useLiveOrder = () => {
    const ctx = useContext(LiveOrderContext);
    if (!ctx) throw new Error('useLiveOrder must be used within LiveOrderProvider');
    return ctx;
};
