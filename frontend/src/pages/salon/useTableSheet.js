import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import usePolling from '@/hooks/usePolling';
import {
    addOrderItems,
    createOrder,
    getOrder,
    listOrders,
    mergeOrder,
    moveOrder,
    moveOrderItem,
    removeOrderItem,
    sendOrderToKitchen,
    setOrderAlias,
    splitOrder,
    updateOrderItem,
    voidOrderItem,
} from '@/lib/api/orders';
import { draftCount } from '@/lib/orderDraft';
import { groupAccountTables } from '@/lib/tableGroups';
import { isComposingDraft } from '@/pages/salon/selectors';

/**
 * State and actions of the table sheet: the open table, the account in view, the
 * menu composer and everything the waiter does inside it. The container only
 * wires it to the floor (`refreshAll`) and to the permissions.
 */
export default function useTableSheet({
    tables, activeOrders, canTake, refreshAll,
}) {
    const [openTable, setOpenTable] = useState(null);
    const [savingItem, setSavingItem] = useState(false);
    const [aliasDraft, setAliasDraft] = useState('');
    // Mensaje de confirmación tras enviar: "✓ Pedido de Juan enviado.
    // ¿Siguiente persona?" — la pantalla queda limpia para la siguiente.
    const [flash, setFlash] = useState(null);
    // Interruptor de la cuenta compartida de la mesa (la fuente, la jarra).
    const [sharedDraft, setSharedDraft] = useState(false);
    const [receiptOpen, setReceiptOpen] = useState(false);
    // La carta arranca plegada: el modal abre mostrando lo que ya se pidió y el
    // "+ Pedido" del encabezado la despliega. Se vuelve a plegar al enviar, así el
    // mozo ve el pedido que acaba de mandar y tiene el + listo para el siguiente.
    const [composerOpen, setComposerOpen] = useState(false);
    const [moveAccountId, setMoveAccountId] = useState(null);
    // Última cuenta abierta en la hoja: alimenta el mini-reproductor del pedido
    // activo. Se guarda la mesa en mano (no solo el id) para poder reabrir la
    // hoja sin depender de que la mesa siga en el listado del polling.
    const [lastOpened, setLastOpened] = useState(null);

    const openOrderId = openTable?.order?.id || null;
    const { data: liveOrderData } = usePolling(
        () => (openOrderId ? getOrder(openOrderId).then((r) => r.data) : Promise.resolve(null)),
        10000,
        [openOrderId]
    );
    const sheetOrder = openTable?.order && liveOrderData && liveOrderData.id === openTable.order.id
        ? liveOrderData
        : (openTable?.order || null);

    const closeSheet = () => setOpenTable(null);

    // Multi-cuenta: cambia la cuenta activa que se muestra en el sheet.
    const selectAccount = async (orderId) => {
        setOpenTable((s) => (s ? { ...s, accountId: orderId, loading: true } : s));
        try {
            const { data } = await getOrder(orderId);
            setOpenTable((s) => (s && s.accountId === orderId ? { ...s, order: data, loading: false } : s));
        } catch {
            setOpenTable((s) => (s ? { ...s, loading: false } : s));
        }
    };

    const openSheet = async (t, preferredOrderId = null) => {
        // A joined table with no account of its own reads the group's account,
        // but only when the group holds exactly one: with two separate bills
        // there is nothing unambiguous to follow, so the sheet lists them.
        const groupOwners = t.group?.id ? groupAccountTables(t.group, tables, activeOrders) : [];
        const followed = groupOwners.length === 1 && groupOwners[0].id !== t.id && !t.active_order ? groupOwners[0] : null;
        const targetOrderId = preferredOrderId || t.active_order?.id || followed?.active_order?.id || null;
        setComposerOpen(false);
        setOpenTable({ table: t, order: null, history: null, group: t.group || null, accountTable: followed, loading: Boolean(targetOrderId), accounts: [], accountId: targetOrderId || null });
        if (targetOrderId) {
            try {
                const { data } = await getOrder(targetOrderId);
                setOpenTable((s) => (s && s.table.id === t.id ? { ...s, order: data, loading: false } : s));
                // Un pedido a medio armar es el que la mesa retoma: ahí la carta se
                // abre sola, sin obligar a buscar el botón.
                if (isComposingDraft(data)) setComposerOpen(true);
            } catch {
                setOpenTable((s) => (s && s.table.id === t.id ? { ...s, loading: false } : s));
            }
        }
        try {
            const { data } = await listOrders({ table_id: t.id, limit: 50 });
            const all = data || [];
            const active = all.filter((o) => !['pagado', 'cancelado'].includes(o.status));
            const past = all.filter((o) => ['pagado', 'cancelado'].includes(o.status)).slice(0, 8);
            setOpenTable((s) => (s && s.table.id === t.id ? { ...s, accounts: active, history: past } : s));
            // Sin orden objetivo pero con cuentas abiertas: seguí la primera.
            if (!targetOrderId && active.length) await selectAccount(active[0].id);
        } catch { /* historial opcional */ }
    };

    // Multi-cuenta: fusiona todas las demás cuentas dentro de la seleccionada.
    const mergeAccounts = async () => {
        const s = openTable;
        if (!s || !canTake) return;
        const list = s.accounts || [];
        const targetId = s.order?.id || s.accountId || s.table?.active_order?.id;
        if (!targetId || list.length < 2) return;
        const others = list.filter((o) => o.id !== targetId);
        try {
            for (const o of others) {
                await mergeOrder(targetId, { source_order_id: o.id });
            }
            toast.success('Cuentas fusionadas');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudieron fusionar las cuentas');
        }
    };

    // Multi-cuenta: mueve la cuenta seleccionada a una mesa libre.
    const moveAccount = async (targetTableId) => {
        if (!moveAccountId) return;
        try {
            await moveOrder(moveAccountId, { target_table_id: targetTableId });
            toast.success('Cuenta movida');
            setMoveAccountId(null);
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo mover la cuenta');
        }
    };

    // Multi-cuenta: reparte los productos de la cuenta seleccionada en N cuentas.
    const splitAccount = async (parts) => {
        const s = openTable;
        const targetId = s?.order?.id || s?.accountId || s?.table?.active_order?.id;
        if (!targetId || !canTake) return;
        try {
            await splitOrder(targetId, { parts });
            toast.success(`Cuenta dividida en ${parts}`);
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo dividir la cuenta');
        }
    };

    // ── Pedido inline (sin salir del salón) ────────────────────────────────
    const reloadCurrentOrder = async (orderId) => {
        try {
            const { data } = await getOrder(orderId);
            setOpenTable((s) => (s && (s.order?.id === orderId || s.accountId === orderId)
                ? { ...s, order: data, accountId: orderId }
                : s));
        } catch { /* la recarga es best-effort */ }
    };

    // La cuenta de la mesa se crea recién al agregar el primer producto, así
    // abrir el sheet y arrepentirse no deja una orden vacía.
    const ensureAccount = async () => {
        const s = openTable;
        if (!s) return null;
        // Sólo la cuenta que el mozo tiene delante. El pedido activo de la mesa
        // NO sirve de atajo: con la pantalla limpia, lo que se carga es de la
        // siguiente persona, no un adicional de la anterior.
        const existing = s.order?.id || s.accountId || null;
        if (existing) return existing;
        const payload = { table_id: s.table.id, order_type: 'mesa' };
        // Si la mesa ya tiene su visita abierta, esta cuenta es OTRA persona de
        // esa misma visita y hay que pedirla como tal: sin esto el backend la
        // rechaza por pertenecer a una visita en curso.
        if (s.table?.active_attention_id || (s.accounts || []).length > 0) {
            payload.new_account = true;
        }
        const { data } = await createOrder(payload);
        setOpenTable((prev) => (prev && prev.table.id === s.table.id
            ? { ...prev, order: data, accountId: data.id, accounts: [...(prev.accounts || []), data] }
            : prev));
        return data.id;
    };

    const addProductToAccount = async (product) => {
        if (!canTake || savingItem) return;
        setSavingItem(true);
        // Arrancó el pedido siguiente: el aviso del envío anterior ya cumplió.
        setFlash(null);
        try {
            const orderId = await ensureAccount();
            if (!orderId) return;
            await addOrderItems(orderId, [{ product_id: product.id, quantity: 1 }]);
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo agregar el producto');
        } finally {
            setSavingItem(false);
        }
    };

    const changeItemQty = async (item, delta) => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake) return;
        const next = Number(item.quantity || 1) + delta;
        try {
            if (next <= 0) await removeOrderItem(orderId, item.id);
            else await updateOrderItem(orderId, item.id, { quantity: next });
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar la cantidad');
        }
    };

    // El "−" de la carta sólo baja lo que sigue en borrador. Si el plato ya
    // viajó a cocina, el backend lo rechaza y el camino es anularlo abajo.
    const removeProductFromAccount = async (product, item) => {
        if (!item) return;
        await changeItemQty(item, -1);
    };

    // Las observaciones pertenecen al producto: "sin ensalada" es de ese plato,
    // no de la cuenta ni de la mesa.
    const saveItemNotes = async (item, notes) => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake) return;
        try {
            await updateOrderItem(orderId, item.id, { notes });
            await reloadCurrentOrder(orderId);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar la observación');
        }
    };

    // Anular producto: lo enviado no se borra, se anula y deja de cobrarse.
    const voidProduct = async (item, reason) => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake) return;
        try {
            await voidOrderItem(orderId, item.id, { reason });
            toast.success('Producto anulado');
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo anular el producto');
        }
    };

    /**
     * La identidad de la cuenta (alias y compartida) se guarda al enviar: no hay
     * botón de guardar. Sólo se persiste lo que el mozo cambió.
     */
    const persistAlias = async (orderId) => {
        const account = (openTable?.accounts || []).find((o) => o.id === orderId)
            || (openTable?.order?.id === orderId ? openTable.order : null);
        const currentName = account?.customer_name || '';
        const nextName = aliasDraft.trim();
        const currentShared = Boolean(account?.shared);
        if (nextName === currentName && sharedDraft === currentShared) return;
        await setOrderAlias(orderId, { alias: nextName || null, shared: sharedDraft });
    };

    /**
     * Observación rápida. Con más de una unidad la observación es de UNA unidad
     * ("2 sopas, una sin cebolla"), así que primero se agrega la unidad anotada y
     * recién después se descuenta del grupo: si algo falla, nunca se pierde comida.
     */
    const applyItemNote = async (item, note) => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake || !item) return;
        try {
            if (Number(item.quantity || 1) > 1) {
                await addOrderItems(orderId, [{ product_id: item.product_id, quantity: 1, notes: note }]);
                await updateOrderItem(orderId, item.id, { quantity: Number(item.quantity) - 1 });
            } else {
                await updateOrderItem(orderId, item.id, { notes: note });
            }
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar la observación');
        }
    };

    // Corregir "quién pidió qué" sin borrar y volver a cargar el producto. El
    // origen sale de la propia línea: con la pantalla limpia no hay cuenta
    // seleccionada, pero el producto sí sabe de quién es.
    const moveItemToPerson = async (item, targetOrderId, sourceOrderId = null) => {
        const orderId = sourceOrderId || openTable?.order?.id || openTable?.accountId;
        if (!orderId || !targetOrderId || !canTake) return;
        try {
            await moveOrderItem(orderId, item.id, { target_order_id: targetOrderId });
            toast.success('Producto movido de persona');
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo mover el producto');
        }
    };

    // Los platos de una cuenta concreta, para saber cuántos adicionales viajaron.
    const sendItemsFor = (orderId) => {
        const account = (openTable?.accounts || []).find((o) => o.id === orderId);
        return (account || sheetOrder || {}).items || [];
    };

    /**
     * Envía a cocina los borradores de la cuenta.
     *
     * El id es opcional para que el mini-reproductor pueda mandar la cuenta que
     * mantiene a la vista sin abrir su hoja; sin id, usa la cuenta abierta.
     */
    const sendCurrentToKitchen = async (orderId = null) => {
        // Un `onClick={handler}` cuela el evento de React como primer argumento:
        // solo un id de texto identifica una cuenta. Sin esta guarda, el destino
        // acababa siendo "[object Object]" y la petición iba a /orders/[object Object].
        const requested = typeof orderId === 'string' ? orderId : null;
        const targetId = requested || openTable?.order?.id || openTable?.accountId;
        if (!targetId || !canTake) return;
        const openId = openTable?.order?.id || openTable?.accountId;
        try {
            // El alias viaja con la comanda: se guarda acá, sin botón aparte.
            if (targetId === openId) await persistAlias(targetId);
            const { data } = await sendOrderToKitchen(targetId);
            const pending = draftCount(sendItemsFor(targetId), data?.status);
            const who = data?.customer_name || (data?.shared ? 'Compartido' : 'la persona');
            toast.success(pending > 0 ? `Enviados ${pending} adicionales` : 'Enviado a cocina');
            await reloadCurrentOrder(targetId);
            if (targetId === openId) {
                // La persona ya quedó registrada: la pantalla se limpia sola para
                // la siguiente, que es como el mozo trabaja de verdad. La carta se
                // pliega y el "+ Pedido" del encabezado queda listo para el próximo.
                setFlash(`✓ Pedido de ${who} enviado. ¿Siguiente persona?`);
                setComposerOpen(false);
                setOpenTable((s) => (s ? {
                    ...s,
                    order: null,
                    accountId: null,
                    accounts: (s.accounts || []).some((o) => o.id === data?.id)
                        ? (s.accounts || []).map((o) => (o.id === data?.id ? data : o))
                        : [...(s.accounts || []), data].filter(Boolean),
                } : s));
            }
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar a cocina');
        }
    };

    // El alias también se puede fijar sin enviar (al salir del campo).
    const saveAlias = async () => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake) return;
        try {
            await persistAlias(orderId);
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar el alias');
        }
    };

    // Empezar el pedido de OTRA persona: la pantalla se limpia y el próximo plato
    // abre una cuenta nueva de la misma visita. No es "abrir cuenta" — eso lo
    // decide el sistema — sino pasar a la siguiente persona.
    const startAnotherPerson = () => {
        setFlash(null);
        setOpenTable((s) => (s ? { ...s, order: null, accountId: null, loading: false } : s));
    };

    // "Tomar pedido" abre el sheet; la cuenta se crea al agregar el primer
    // producto. No navega a /pedidos.
    const takeOrderInline = async (t) => {
        if (!canTake) { toast.info('Solo el mozo puede tomar la mesa'); return; }
        if (t.status === 'pagada') { toast.info('Liberá la mesa pagada antes de tomar pedido'); return; }
        await openSheet(t);
    };

    // El alias del formulario sigue a la cuenta que se está viendo.
    useEffect(() => {
        setAliasDraft(openTable?.order?.customer_name || '');
        setSharedDraft(Boolean(openTable?.order?.shared));
    }, [openTable?.order?.id, openTable?.order?.customer_name, openTable?.order?.shared]);

    // ── Mini-reproductor del pedido activo ─────────────────────────────────
    // Mientras la hoja está abierta con una cuenta cargada, esa cuenta pasa a
    // ser "la última": es la que el mini mantiene a la vista cuando el mozo
    // vuelve al plano. El setter está guardado por id para que el polling no
    // re-renderice en cada refresco.
    useEffect(() => {
        const t = openTable?.table;
        const orderId = openTable?.order?.id;
        if (!t || !orderId) return;
        setLastOpened((prev) => (prev && prev.tableId === t.id && prev.accountId === orderId
            ? prev
            : { tableId: t.id, accountId: orderId, table: t, account: openTable.order }));
    }, [openTable?.table, openTable?.order?.id, openTable?.order]);

    const openTrackedSheet = () => {
        if (!lastOpened) return;
        void openSheet(lastOpened.table, lastOpened.accountId);
    };

    return {
        openTable,
        sheetOrder,
        savingItem,
        aliasDraft,
        setAliasDraft,
        flash,
        setFlash,
        sharedDraft,
        setSharedDraft,
        receiptOpen,
        setReceiptOpen,
        composerOpen,
        setComposerOpen,
        moveAccountId,
        setMoveAccountId,
        lastOpened,
        openSheet,
        closeSheet,
        selectAccount,
        mergeAccounts,
        moveAccount,
        splitAccount,
        addProductToAccount,
        changeItemQty,
        removeProductFromAccount,
        saveItemNotes,
        voidProduct,
        applyItemNote,
        moveItemToPerson,
        sendCurrentToKitchen,
        saveAlias,
        startAnotherPerson,
        takeOrderInline,
        openTrackedSheet,
    };
}
