import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import usePolling from '@/hooks/usePolling';
import useOrderLineSync from '@/hooks/useOrderLineSync';
import {
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
import { apiErrorMessage } from '@/lib/apiError';
import { draftCount, editableItems, isDraft } from '@/lib/orderDraft';
import { plainDraftLine } from '@/lib/optimisticOrder';
import { groupAccountTables, groupMembers } from '@/lib/tableGroups';
import {
    accountSnapshots,
    canComposeAccountAt,
    isComposableTable,
    isComposingDraft,
    selectFreshOrder,
    selectMiniOrder,
    selectReviewOrder,
} from './selectors';

/**
 * State and actions of the table sheet: the open table, the account in view,
 * the menu composer, the send review and everything the waiter does inside it.
 * The container only wires it to the floor (`refreshAll`) and to the permissions.
 */
export default function useTableSheet({
    tables, orders, activeOrders, canTake, refreshAll,
}) {
    const [openTable, setOpenTable] = useState(null);
    const [moveAccountId, setMoveAccountId] = useState(null);
    const [savingItem, setSavingItem] = useState(false);
    // Bloquea el doble envío mientras el POST está en vuelo (el ticket se
    // desmonta al volver al detalle, pero un doble toque no debe repetir).
    const [sendingToKitchen, setSendingToKitchen] = useState(false);
    const [aliasDraft, setAliasDraft] = useState('');
    // Interruptor de la cuenta compartida de la mesa (la fuente, la jarra).
    const [sharedDraft, setSharedDraft] = useState(false);
    const [receiptOpen, setReceiptOpen] = useState(false);
    // El bloque "Resumen de mesa" (filas agrupadas + mover de persona + recibo)
    // vive en un diálogo que se abre desde ⋯ Más: el mockup no lo muestra en el
    // cuerpo del detalle.
    const [summaryOpen, setSummaryOpen] = useState(false);
    // La carta arranca plegada: el modal abre mostrando lo que ya se pidió y el
    // "+ Pedido" del encabezado la despliega. Se vuelve a plegar al enviar, así el
    // mozo ve el pedido que acaba de mandar y tiene el + listo para el siguiente.
    const [composerOpen, setComposerOpen] = useState(false);
    const [reviewOrderId, setReviewOrderId] = useState(null);
    const [personNameEdit, setPersonNameEdit] = useState(false);
    // Renombre del alias desde el ✎ de cada tarjeta de cuenta (mueve el mismo
    // editor que antes vivía en la franja de personas).
    const [cardRenameId, setCardRenameId] = useState(null);
    const [cardRenameDraft, setCardRenameDraft] = useState('');
    // Última cuenta abierta en la hoja: alimenta el mini-reproductor del pedido
    // activo. Se guarda la mesa en mano (no solo el id) para poder reabrir la
    // hoja sin depender de que la mesa siga en el listado del polling.
    const [lastOpened, setLastOpened] = useState(null);
    const escapeActionsRef = useRef(null);
    // The queue worker runs between renders, so it reads the sheet through refs.
    const openTableRef = useRef(null);
    // Id of an account created by the queue that the sheet state has not shown yet:
    // it keeps the next queued product from creating a second account.
    const createdAccountRef = useRef(null);
    const leavingRef = useRef(false);
    const [awaitingSend, setAwaitingSend] = useState(false);

    openTableRef.current = openTable;
    if (createdAccountRef.current && openTable?.order?.id === createdAccountRef.current.id) {
        createdAccountRef.current = null;
    }

    const openOrderId = openTable?.order?.id || null;
    const { data: liveOrderData } = usePolling(
        () => (openOrderId ? getOrder(openOrderId).then((r) => r.data) : Promise.resolve(null)),
        10000,
        [openOrderId]
    );
    // La hoja muestra el snapshot más fresco: el polling vivo puede ser anterior
    // a una recarga puntual (alta de producto, alias), y con la versión vieja la
    // línea recién agregada no aparecía hasta el próximo refresco.
    const serverOrder = selectFreshOrder(openTable?.order, liveOrderData);

    const composeTableFor = (account) => {
        const selectedTable = (tables || []).find((table) => table.id === openTable?.table?.id) || openTable?.table;
        if (account?.table_id === selectedTable?.id) return selectedTable;
        const group = selectedTable?.group;
        return groupMembers(group, tables || []).find((table) => (
            table.id === account?.table_id && table.group?.id === group?.id
        )) || null;
    };

    const openSheet = async (t, preferredOrderId = null) => {
        if (writing() || sendingToKitchen || openTable?.loading) return null;
        // A joined table with no account of its own reads the group's account,
        // but only when the group holds exactly one: with two separate bills
        // there is nothing unambiguous to follow, so the sheet lists them.
        const groupOwners = t.group?.id ? groupAccountTables(t.group, tables, activeOrders) : [];
        const followed = groupOwners.length === 1 && groupOwners[0].id !== t.id && !t.active_order ? groupOwners[0] : null;
        const targetOrderId = preferredOrderId || t.active_order?.id || followed?.active_order?.id || null;
        let loadedOrder = null;
        setComposerOpen(false);
        setOpenTable({ table: t, order: null, history: null, group: t.group || null, accountTable: followed, loading: true, accounts: [], accountId: targetOrderId || null });
        if (targetOrderId) {
            try {
                const { data } = await getOrder(targetOrderId);
                if (data?.id === targetOrderId) {
                    loadedOrder = data;
                    setOpenTable((s) => (s && s.table.id === t.id ? { ...s, order: data } : s));
                }
                // Un pedido a medio armar es el que la mesa retoma: ahí la carta se
                // abre sola, sin obligar a buscar el botón.
                if (canTake && isComposableTable(t) && canComposeAccountAt(loadedOrder, followed || t)
                    && isComposingDraft(loadedOrder)) {
                    setComposerOpen(true);
                }
            } catch { /* Continue loading the optional account list. */ }
        }
        try {
            const { data } = await listOrders({ table_id: t.id, limit: 50 });
            const all = data || [];
            const active = all.filter((o) => !['pagado', 'cancelado'].includes(o.status));
            const past = all.filter((o) => ['pagado', 'cancelado'].includes(o.status)).slice(0, 8);
            setOpenTable((s) => (s && s.table.id === t.id ? {
                ...s, accounts: accountSnapshots({ ...s, accounts: active }, s.order), history: past,
            } : s));
            // Sin orden objetivo pero con cuentas abiertas: seguí la primera.
            if (!targetOrderId && active.length) loadedOrder = await selectAccount(active[0].id);
        } catch { /* historial opcional */ } finally {
            setOpenTable((s) => (s && s.table.id === t.id ? { ...s, loading: false } : s));
        }
        return loadedOrder;
    };

    const closeSheet = () => leaveComposer({ closeTable: true });

    // Multi-cuenta: cambia la cuenta activa que se muestra en el sheet.
    const selectAccount = async (orderId, validate = null) => {
        if (!orderId || writing() || sendingToKitchen || openTable?.loading) return null;
        setOpenTable((s) => (s ? {
            ...s, accounts: accountSnapshots(s, serverOrder), accountId: orderId, loading: true,
        } : s));
        try {
            const { data } = await getOrder(orderId);
            if (data?.id !== orderId || (validate && !validate(data))) {
                setOpenTable((s) => (s && s.accountId === orderId
                    ? { ...s, accountId: s.order?.id || null, loading: false }
                    : s));
                return null;
            }
            setOpenTable((s) => (s && s.accountId === orderId ? {
                ...s, order: data, accounts: accountSnapshots(s, data), loading: false,
                accountTable: data.table_id === s.table.id ? null
                    : (tables || []).find((table) => table.id === data.table_id) || s.accountTable,
            } : s));
            return data;
        } catch {
            setOpenTable((s) => (s && s.accountId === orderId
                ? { ...s, accountId: s.order?.id || null, loading: false }
                : s));
            return null;
        }
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
            toast.error(apiErrorMessage(e, 'No se pudieron fusionar las cuentas'));
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
            toast.error(apiErrorMessage(e, 'No se pudo mover la cuenta'));
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
            toast.error(apiErrorMessage(e, 'No se pudo dividir la cuenta'));
        }
    };

    // ── Pedido inline (sin salir del salón) ────────────────────────────────
    // Re-reads an account into the sheet. Best-effort by default; the sync queue
    // asks for `strict` so a dead network is reported instead of hidden.
    const reloadCurrentOrder = async (orderId, { strict = false } = {}) => {
        try {
            const { data } = await getOrder(orderId);
            if (data?.id !== orderId) return null;
            setOpenTable((s) => {
                if (!s) return s;
                const isSelected = s.order?.id === orderId || s.accountId === orderId;
                return {
                    ...s, accounts: accountSnapshots(s, data),
                    ...(isSelected ? { order: data, accountId: orderId } : {}),
                };
            });
            return data;
        } catch (e) {
            if (strict) throw e;
            return null; /* la recarga es best-effort */
        }
    };

    // La cuenta de la mesa se crea recién al agregar el primer producto, así
    // abrir el sheet y arrepentirse no deja una orden vacía. La llama la cola de
    // sincronización (fuera del render), por eso lee la hoja desde refs.
    const ensureAccount = async () => {
        const s = openTableRef.current;
        if (!s) return null;
        // Sólo la cuenta que el mozo tiene delante. El pedido activo de la mesa
        // NO sirve de atajo: con la pantalla limpia, lo que se carga es de la
        // siguiente persona, no un adicional de la anterior.
        const created = createdAccountRef.current;
        const existing = s.order?.id || s.accountId
            || (created?.tableId === s.table.id ? created.id : null);
        if (existing) return existing;
        const payload = { table_id: s.table.id, order_type: 'mesa' };
        // Si la mesa ya tiene su visita abierta, esta cuenta es OTRA persona de
        // esa misma visita y hay que pedirla como tal: sin esto el backend la
        // rechaza por pertenecer a una visita en curso.
        if (s.table?.active_attention_id || (s.accounts || []).length > 0) {
            payload.new_account = true;
        }
        const { data } = await createOrder(payload);
        createdAccountRef.current = { tableId: s.table.id, id: data.id };
        setOpenTable((prev) => (prev && prev.table.id === s.table.id
            ? { ...prev, order: data, accountId: data.id, accounts: [...(prev.accounts || []), data] }
            : prev));
        return data.id;
    };

    // Cada toque cambia la cantidad en pantalla al instante; la cola manda al
    // servidor la cantidad neta, de a una petición, sin deshabilitar la carta.
    // El pedido vacío es lo que se ve antes de que exista la cuenta.
    const emptyOrder = useMemo(() => ({
        id: null, status: 'nuevo', items: [], total: 0, table_id: openTable?.table?.id || null,
    }), [openTable?.table?.id]);

    const sync = useOrderLineSync({
        order: serverOrder,
        placeholder: emptyOrder,
        ensureOrderId: ensureAccount,
        loadOrder: (orderId) => reloadCurrentOrder(orderId, { strict: true }),
        onError: (error, entry) => {
            // The line is already back at the last confirmed quantity; one toast,
            // and a re-read in case the server did apply part of it.
            toast.error(apiErrorMessage(
                error,
                entry.kind === 'new' && !entry.lineId ? 'No se pudo agregar el producto' : 'No se pudo cambiar la cantidad'
            ));
            if (entry.orderId) void reloadCurrentOrder(entry.orderId);
        },
        onSynced: () => refreshAll(),
    });
    // What the screen shows: the confirmed order plus the taps still on their way.
    const sheetOrder = sync.order;
    // Other writes wait while taps are still being saved (leaving and sending flush them).
    const writing = () => savingItem || sync.busy();

    const addProductToAccount = async (product) => {
        if (!canTake || sendingToKitchen || openTable?.loading) return;
        await sync.tap(product, 1);
    };

    // La cantidad de una línea concreta (el stepper del ticket).
    const changeItemQty = async (item, delta) => {
        if (!canTake || sendingToKitchen || openTable?.loading) return;
        const orderId = openTable?.order?.id || openTable?.accountId || sync.latest()?.id || null;
        await sync.changeLine(item, delta, orderId);
    };

    // S14: el paso de confirmación puede operar sobre OTRA cuenta (el
    // mini-reproductor no abre la hoja), así que el destino es explícito.
    const changeItemQtyFor = async (orderId, item, delta) => {
        if (!orderId || !canTake || savingItem || sendingToKitchen || openTable?.loading) return;
        const next = Number(item.quantity || 1) + delta;
        setSavingItem(true);
        try {
            if (next <= 0) await removeOrderItem(orderId, item.id);
            else await updateOrderItem(orderId, item.id, { quantity: next });
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo cambiar la cantidad'));
        } finally {
            setSavingItem(false);
        }
    };

    // El "−" de la carta sólo baja lo que sigue en borrador. Si el plato ya
    // viajó a cocina, el backend lo rechaza y el camino es anularlo abajo.
    const removeProductFromAccount = async (product, item) => {
        if (!item || !canTake || sendingToKitchen || openTable?.loading) return;
        await sync.tap(product, -1);
    };

    // Las observaciones pertenecen al producto: "sin ensalada" es de ese plato,
    // no de la cuenta ni de la mesa.
    const saveItemNotes = async (item, notes) => {
        if (!canTake || sendingToKitchen || openTable?.loading) return;
        // The line may still be waiting to be created, or a tap may be moving its
        // quantity: let the queue finish so the note lands on the real line.
        if (sync.busy()) await sync.flush();
        const fresh = sync.latest();
        const orderId = fresh?.id || openTable?.order?.id || openTable?.accountId;
        const real = item.__virtual ? plainDraftLine(fresh, item.product_id) : item;
        if (!real) return;
        await saveItemNotesFor(orderId, real, notes);
    };

    const saveItemNotesFor = async (orderId, item, notes) => {
        if (!orderId || !canTake || savingItem || sendingToKitchen || openTable?.loading) return;
        setSavingItem(true);
        try {
            await updateOrderItem(orderId, item.id, { notes });
            await reloadCurrentOrder(orderId);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo guardar la observación'));
        } finally {
            setSavingItem(false);
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
            toast.error(apiErrorMessage(e, 'No se pudo anular el producto'));
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
            toast.error(apiErrorMessage(e, 'No se pudo mover el producto'));
        }
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
        if (!targetId || !canTake || savingItem || sendingToKitchen || openTable?.loading) return;
        const openId = openTable?.order?.id || openTable?.accountId;
        // Primer envío de la cuenta (todavía estaba en 'nuevo'): el aviso es el
        // del prototipo, "Enviado a cocina · Mesa N".
        const accountBefore = (openTable?.accounts || []).find((o) => o.id === targetId)
            || (openTable?.order?.id === targetId ? openTable.order : null);
        const firstSend = (accountBefore?.status || 'nuevo') === 'nuevo';
        setSendingToKitchen(true);
        try {
            // Never send a stale draft: wait for the taps still on their way, and
            // stop if one of them failed (the waiter never saw that quantity confirmed).
            if (sync.busy()) {
                const failedBefore = sync.failures();
                await sync.flush();
                if (sync.failures() > failedBefore) return false;
            }
            // El alias viaja con la comanda: se guarda acá, sin botón aparte.
            if (targetId === openId) await persistAlias(targetId);
            const { data } = await sendOrderToKitchen(targetId);
            const latestOrder = sync.latest();
            const pending = draftCount(latestOrder?.id === targetId ? latestOrder.items || [] : sendItemsFor(targetId), data?.status);
            const mesaNumber = openTable?.table?.number || lastOpened?.table?.number || data?.table_number || null;
            // Un solo aviso (toast), como el mockup: sin cartel fijo en el cuerpo.
            toast.success(firstSend
                ? (mesaNumber ? `Enviado a cocina · Mesa ${mesaNumber}` : 'Enviado a cocina')
                : (pending > 0 ? `Enviados ${pending} adicionales` : 'Enviado a cocina'));
            await reloadCurrentOrder(targetId);
            if (targetId === openId) {
                // La persona ya quedó registrada: la pantalla se limpia sola para
                // la siguiente.
                createdAccountRef.current = null;
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
            setReviewOrderId(null);
            refreshAll();
            return true;
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo enviar a cocina'));
            return false;
        } finally {
            setSendingToKitchen(false);
        }
    };

    // The first action opens an order review; only explicit confirmation reaches
    // the existing guarded sender.
    const requestSend = (orderId = null) => {
        const requested = typeof orderId === 'string' ? orderId : null;
        const targetId = requested || openTable?.order?.id || openTable?.accountId;
        if (!canTake || sendingToKitchen || openTable?.loading) return;
        if (!targetId) {
            // The first product is still creating the account: review once it exists.
            if (sync.busy()) setAwaitingSend(true);
            return;
        }
        if (savingItem) return;
        setReviewOrderId(targetId);
    };

    // Always the latest closure, so the deferred review sees the account that
    // the queue has just created.
    const requestSendRef = useRef(null);
    requestSendRef.current = requestSend;
    const syncing = sync.syncing;
    useEffect(() => {
        if (!awaitingSend || syncing) return;
        setAwaitingSend(false);
        requestSendRef.current();
    }, [awaitingSend, syncing]);

    const confirmReviewedSend = async () => {
        if (!reviewOrderId || !reviewItems.length || savingItem || sendingToKitchen) return;
        const targetId = reviewOrderId;
        const sent = await sendCurrentToKitchen(targetId);
        if (sent) setReviewOrderId(null);
    };

    // Los platos de una cuenta concreta, para saber cuántos adicionales viajaron.
    const sendItemsFor = (orderId) => {
        const account = (openTable?.accounts || []).find((o) => o.id === orderId);
        return (account || serverOrder || {}).items || [];
    };

    // El alias también se puede fijar sin enviar (al salir del campo).
    const saveAlias = async () => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake || writing() || sendingToKitchen) return;
        setSavingItem(true);
        try {
            await persistAlias(orderId);
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo guardar el alias'));
        } finally {
            setSavingItem(false);
        }
    };

    /**
     * Renombra una cuenta desde el ✎ de su tarjeta (detalle) o de la franja
     * "Para {persona}" (compositor). Mismo PATCH de alias que el input viejo,
     * apuntado a la persona elegida y conservando el "Compartido" que ya tenía.
     */
    const renamePerson = async (orderId, alias) => {
        if (!canTake || !orderId || writing() || sendingToKitchen || openTable?.loading) return;
        const account = (openTable?.accounts || []).find((o) => o.id === orderId)
            || (openTable?.order?.id === orderId ? openTable.order : null);
        const nextName = alias || null;
        setSavingItem(true);
        try {
            await setOrderAlias(orderId, { alias: nextName, shared: Boolean(account?.shared) });
            // La franja lee las cuentas de la hoja: se actualiza en el acto para
            // que el nombre no espere al próximo refresco del piso.
            setOpenTable((s) => (s ? {
                ...s,
                accounts: (s.accounts || []).map((o) => (o.id === orderId ? { ...o, customer_name: nextName } : o)),
                order: s.order?.id === orderId ? { ...s.order, customer_name: nextName } : s.order,
            } : s));
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo guardar el alias'));
        } finally {
            setSavingItem(false);
        }
    };

    // Cierra el editor del ✎ de una tarjeta guardando sólo si el alias cambió.
    const commitCardRename = (view) => {
        if (!view || cardRenameId !== view.id) return;
        const next = cardRenameDraft.trim();
        setCardRenameId(null);
        if (next === String(view.customer_name || '').trim()) return;
        renamePerson(view.id, next);
    };

    const discardDraftItems = async (orderId, knownOrder = null) => {
        if (!orderId || !canTake || savingItem || sendingToKitchen) return false;
        const current = knownOrder || (serverOrder?.id === orderId ? serverOrder : openTable?.order);
        const drafts = (current?.items || []).filter((it) => isDraft(it, current?.status));
        if (!drafts.length) return true;
        setSavingItem(true);
        try {
            for (const it of drafts) await removeOrderItem(orderId, it.id);
            await reloadCurrentOrder(orderId);
            refreshAll();
            return true;
        } catch (e) {
            await reloadCurrentOrder(orderId);
            toast.error(apiErrorMessage(e, 'No se pudo descartar el pedido'));
            return false;
        } finally {
            setSavingItem(false);
        }
    };

    const leaveComposer = async ({ closeTable = false } = {}) => {
        if (savingItem || sendingToKitchen || openTable?.loading || leavingRef.current) return;
        leavingRef.current = true;
        try {
            // Taps still on their way are saved first, so the draft check below
            // sees what the waiter really ordered.
            let fresh = null;
            if (sync.busy()) {
                await sync.flush();
                fresh = sync.latest();
            }
            const orderId = fresh?.id || openTable?.order?.id || openTable?.accountId;
            const current = fresh?.id === orderId
                ? fresh
                : (serverOrder?.id === orderId ? serverOrder : openTable?.order);
            const hasDrafts = (current?.items || []).some((it) => isDraft(it, current?.status));
            if (hasDrafts) {
                if (!canTake || savingItem || sendingToKitchen) return;
                if (!window.confirm('¿Descartar los productos sin enviar antes de salir?')) return;
                if (!await discardDraftItems(orderId, fresh?.id === orderId ? fresh : null)) return;
            }
            if (closeTable) {
                createdAccountRef.current = null;
                setOpenTable(null);
                setPersonNameEdit(false);
                setSummaryOpen(false);
                setReceiptOpen(false);
            } else {
                setComposerOpen(false);
            }
        } finally {
            leavingRef.current = false;
        }
    };

    // The ticket clear action confirms before deleting draft items only.
    const clearDraft = async () => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake || writing() || sendingToKitchen || openTable?.loading) return;
        if (!window.confirm('¿Vaciar los productos sin enviar? Los productos enviados se conservarán.')) return;
        await discardDraftItems(orderId);
    };

    // A new independent account is created only when its first product is added.
    const startNewAccount = () => {
        const table = (tables || []).find((entry) => entry.id === openTable?.table?.id) || openTable?.table;
        if (!canTake || !isComposableTable(table) || writing() || sendingToKitchen || openTable?.loading) return;
        setOpenTable((s) => (s ? {
            ...s, accounts: accountSnapshots(s, serverOrder), order: null, accountId: null, accountTable: null,
        } : s));
        createdAccountRef.current = null;
        setReviewOrderId(null);
        setPersonNameEdit(false);
        setCardRenameId(null);
        setCardRenameDraft('');
        setAliasDraft('');
        setSharedDraft(false);
        setComposerOpen(true);
    };

    // "Tomar pedido" abre el sheet; la cuenta se crea al agregar el primer
    // producto. No navega a /pedidos.
    const takeOrderInline = async (t) => {
        if (!canTake) { toast.info('Solo el mozo puede tomar la mesa'); return; }
        if (t.status === 'pagada') { toast.info('Libera la mesa pagada antes de tomar pedido'); return; }
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

    const editAccount = async (account) => {
        if (!canTake || !account?.id || writing() || sendingToKitchen || openTable?.loading) return;
        const selectedTable = (tables || []).find((entry) => entry.id === openTable?.table?.id) || openTable?.table;
        if (!isComposableTable(selectedTable)) return;
        const table = composeTableFor(account);
        if (!canComposeAccountAt(account, table)) return;
        const attentionId = table.active_attention_id || account.attention_id;
        setReviewOrderId(null);
        setPersonNameEdit(false);
        setCardRenameId(null);
        const latest = await selectAccount(account.id, (fresh) => canComposeAccountAt(fresh, table, attentionId));
        if (latest?.id !== account.id) return;
        setComposerOpen(true);
    };

    // La cuenta puede haberse cerrado, cobrado o movido desde el último vistazo:
    // el mini solo vive mientras el pedido siga abierto en la lista viva.
    const miniOrder = useMemo(() => selectMiniOrder(orders, lastOpened), [orders, lastOpened]);

    const reviewOrder = selectReviewOrder({ reviewOrderId, sheetOrder, openTable, miniOrder });
    const reviewItems = editableItems(reviewOrder?.items || [], reviewOrder?.status);

    const returnToEdit = async () => {
        if (sendingToKitchen) return;
        const orderId = reviewOrderId;
        if (!orderId) return;
        if (openTable?.order?.id === orderId || openTable?.accountId === orderId) {
            setReviewOrderId(null);
            setComposerOpen(false);
            const latest = await selectAccount(orderId);
            if (latest?.id !== orderId || ['pagado', 'cancelado'].includes(latest.status)
                || !draftCount(latest.items || [], latest.status)) return;
            setComposerOpen(true);
            return;
        }
        if (miniOrder?.id === orderId && lastOpened) {
            const target = lastOpened;
            setReviewOrderId(null);
            setComposerOpen(false);
            const latest = await openSheet(target.table, orderId);
            if (latest?.id !== orderId || ['pagado', 'cancelado'].includes(latest.status)
                || !draftCount(latest.items || [], latest.status)) {
                setComposerOpen(false);
                return;
            }
            setComposerOpen(true);
        }
    };
    // Keep the Escape listener bound to the latest draft and in-flight guards
    // without rebuilding it every render for locally declared handlers.
    escapeActionsRef.current = { leaveComposer, closeSheet };

    useEffect(() => {
        if (!openTable) return undefined;
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
            if (composerOpen) void escapeActionsRef.current.leaveComposer();
            else void escapeActionsRef.current.closeSheet();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [openTable, composerOpen]);

    return {
        openTable,
        sheetOrder,
        moveAccountId,
        setMoveAccountId,
        savingItem,
        syncing: sync.syncing,
        sendingToKitchen,
        aliasDraft,
        setAliasDraft,
        sharedDraft,
        setSharedDraft,
        receiptOpen,
        setReceiptOpen,
        summaryOpen,
        setSummaryOpen,
        composerOpen,
        reviewOrderId,
        setReviewOrderId,
        personNameEdit,
        setPersonNameEdit,
        cardRenameId,
        setCardRenameId,
        cardRenameDraft,
        setCardRenameDraft,
        lastOpened,
        miniOrder,
        reviewOrder,
        reviewItems,
        composeTableFor,
        openSheet,
        closeSheet,
        selectAccount,
        mergeAccounts,
        moveAccount,
        splitAccount,
        changeItemQty,
        changeItemQtyFor,
        addProductToAccount,
        removeProductFromAccount,
        saveItemNotes,
        saveItemNotesFor,
        voidProduct,
        moveItemToPerson,
        sendCurrentToKitchen,
        requestSend,
        confirmReviewedSend,
        saveAlias,
        renamePerson,
        commitCardRename,
        leaveComposer,
        clearDraft,
        startNewAccount,
        takeOrderInline,
        openTrackedSheet,
        editAccount,
        returnToEdit,
    };
}
