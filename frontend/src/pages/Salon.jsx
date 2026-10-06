import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { fmtMoney, fmtElapsed, fmtDateTime, elapsedMinutes, ORDER_STATUS_LABELS } from '@/lib/format';
import OrderComposer, { OrderItems } from '@/components/OrderComposer';
import NewOrderSheet from '@/components/NewOrderSheet';
import { Search, Grid2X2, Plus, Users, ShoppingCart, Link2, Unlink, MoveRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { hasFn } from '@/lib/functions';
import { toast } from 'sonner';
import AttentionReference from '@/components/AttentionReference';
import MesaCard from '@/components/MesaCard';
import GroupCard from '@/components/GroupCard';
import useBranchNames from '@/hooks/useBranchNames';
import { activeAttentionOrder, canCloseAttention } from '@/lib/attentionClose';
import { partitionPriorPickupOrders } from '@/lib/serviceDay';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import {
    groupAccountTables,
    groupLabel,
    groupMembers,
    ordersByTable,
    selectionProblem,
    transferCandidates,
    transferProblem,
} from '@/lib/tableGroups';

/**
 * Salón — unified floor + service screen.
 *
 * Consolidates the former Mesas (floor grid, states, priority) and Servicio
 * (inline actions, summary, visit closure, pickups) screens into one
 * touch-first operating surface for the mozo/cajero/admin.
 *
 * Two floor operations live here on top of that surface:
 *   * "Unir mesas" — a visual group of tables serving the same party. Each
 *     member keeps its own account; the group blocks the free member tables and
 *     is dissolved explicitly.
 *   * "Mover pedido" — relocates the open visit (order + visit) of a table to
 *     another free table of the same branch.
 *
 * Kept `data-testid` contracts: `mesa-card-*`, `mesa-card-deliver-*`,
 * `mesa-card-cobrar-*`, `data-floor-state`, `mesa-sheet-*`, `servicio-cerrar-*`,
 * `servicio-recojos-activos`, `servicio-recojo-*`, `servicio-dias-anteriores`.
 */

const LEGEND = ['libre', 'sentados', 'preparando', 'listo', 'cuenta', 'pagada', 'atencion', 'reservada'];

const STATE_FILTERS = [
    { key: 'todas', label: 'Todas' },
    { key: 'libre', label: 'Libres' },
    { key: 'activas', label: 'Ocupadas' },
    { key: 'listo', label: 'Por entregar' },
    { key: 'cuenta', label: 'Por cobrar' },
];

// Estados del piso que cuenta cada filtro (para los conteos de los filtros).
const STATE_FILTER_FLOORS = {
    libre: ['libre'],
    activas: ['sentados', 'preparando', 'entregado', 'atencion'],
    listo: ['listo'],
    cuenta: ['cuenta'],
};

function floorState(t) {
    const o = t.active_order;
    if (t.status === 'inactiva') return { key: 'inactiva' };
    if (t.status === 'reservada' && !o) return { key: 'reservada' };
    if (o?.status === 'cancelado') return { key: 'atencion' };
    if (o?.status === 'pagado' || (t.status === 'pagada' && !o)) return { key: 'pagada' };
    if (t.status === 'disponible' && !o) return { key: 'libre' };
    if (o?.status === 'pendiente_pago' || t.status === 'esperando_pago') return { key: 'cuenta' };
    if (o?.status === 'listo') return { key: 'listo' };
    if (o?.status === 'entregado') return { key: 'entregado' };
    if (o && ['enviado_cocina', 'en_preparacion', 'nuevo'].includes(o.status)) return { key: 'preparando' };
    if (t.status === 'ocupada' && !o) return { key: 'sentados' };
    return { key: 'sentados' };
}

// Urgencia relativa de cada estado: al unir mesas, el grupo hereda el estado
// más urgente (cuenta > listo > atención > preparando > …). Menor = más urgente.
const FLOOR_RANK = {
    cuenta: 0,
    listo: 1,
    atencion: 2,
    preparando: 3,
    entregado: 4,
    sentados: 5,
    reservada: 6,
    pagada: 7,
    libre: 8,
    inactiva: 9,
};

function groupFloorState(members) {
    return members.reduce((best, m) => (
        (FLOOR_RANK[m.floor.key] ?? 9) < (FLOOR_RANK[best.floor.key] ?? 9) ? m : best
    )).floor;
}

function itemQty(items, predicate) {
    return (items || []).filter(predicate).reduce((s, it) => s + (it.quantity || 0), 0);
}

export default function Salon() {
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const navigate = useNavigate();
    const { generation } = useNotify();

    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [stateFilter, setStateFilter] = useState('todas');
    const [openTable, setOpenTable] = useState(null);
    const [showNewOrder, setShowNewOrder] = useState(false);
    const [closing, setClosing] = useState(null);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState([]);
    const [joining, setJoining] = useState(false);
    const [transferSource, setTransferSource] = useState(null);
    const [movingVisit, setMovingVisit] = useState(false);
    const [moveAccountId, setMoveAccountId] = useState(null);
    const [savingItem, setSavingItem] = useState(false);
    const [aliasDraft, setAliasDraft] = useState('');
    const searchRef = useRef(null);

    const { data: tables, error: tablesError, loading: tablesLoading, refetch: refetchTables } = usePolling(
        () => api.get('/tables').then((r) => r.data),
        8000,
        [generation]
    );
    const { data: liveOrders, error: ordersError, refetch: refetchOrders } = usePolling(
        () => api.get('/orders', { params: { active_only: true } }).then((r) => r.data),
        8000,
        [generation]
    );
    const orders = useMemo(() => (Array.isArray(liveOrders) ? liveOrders : []), [liveOrders]);

    // Carta para componer el pedido sin salir del salón.
    const { data: liveProducts } = usePolling(() => api.get('/products').then((r) => r.data), 60000, [generation]);
    const { data: liveCategories } = usePolling(() => api.get('/categories').then((r) => r.data), 60000);
    const products = useMemo(() => (Array.isArray(liveProducts) ? liveProducts : []), [liveProducts]);
    const categories = useMemo(() => (Array.isArray(liveCategories) ? liveCategories : []), [liveCategories]);

    const canServe = ['admin', 'mozo', 'cocina'].includes(user?.role);
    const canTake = ['admin', 'mozo'].includes(user?.role);
    const canClose = ['admin', 'mozo', 'cajero'].includes(user?.role);
    const canCharge = hasFn(user, 'cobro', 'administracion');

    const byTable = useMemo(() => {
        const map = {};
        for (const o of orders) if (o.table_id) map[o.table_id] = o;
        return map;
    }, [orders]);

    // Only the orders that still own their table: these decide what a joined
    // table can offer (join, transfer) and which member holds the account.
    const activeOrders = useMemo(() => ordersByTable(orders), [orders]);

    const selectionIssue = selected.length >= 2 ? selectionProblem(tables || [], activeOrders, selected) : null;
    const canConfirmJoin = selected.length >= 2 && !selectionIssue;
    const transferTargets = useMemo(
        () => transferCandidates(tables || [], activeOrders, transferSource),
        [tables, activeOrders, transferSource]
    );

    const openOrderId = openTable?.order?.id || null;
    const { data: liveOrderData } = usePolling(
        () => (openOrderId ? api.get(`/orders/${openOrderId}`).then((r) => r.data) : Promise.resolve(null)),
        10000,
        [openOrderId]
    );
    const sheetOrder = openTable?.order && liveOrderData && liveOrderData.id === openTable.order.id
        ? liveOrderData
        : (openTable?.order || null);

    // ── Summary (former Servicio header) ───────────────────────────────────
    const summary = useMemo(() => {
        let toPrep = 0;
        let toReady = 0;
        let toPay = 0;
        for (const o of orders) {
            const items = o.items || [];
            toPrep += itemQty(items, (it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
            toReady += itemQty(items, (it) => it.status === 'listo');
            const due = Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0));
            if (due > 0) toPay += 1;
        }
        return { toPrep, toReady, toPay };
    }, [orders]);

    // Región viva para lectores de pantalla: el salón se actualiza por polling y
    // los cambios de estado llegan sin aviso (4.1.3). El texto solo cambia si
    // cambian los conteos, así que no se repite en cada refresco.
    const floorSummary = `En preparación ${summary.toPrep} · listos para entregar ${summary.toReady} · cuentas por cobrar ${summary.toPay}`;

    const pickupProjection = useMemo(() => {
        const { live, prior } = partitionPriorPickupOrders(orders);
        const active = live.filter((o) => (
            o.order_type === 'recojo'
            && !o.table_id
            && !['entregado', 'pagado', 'cancelado'].includes(o.status)
        ));
        return { active, prior };
    }, [orders]);

    // ── Filters ────────────────────────────────────────────────────────────
    const areas = useMemo(() => {
        const s = new Set((tables || []).map((t) => t.area));
        return ['todas', ...Array.from(s)];
    }, [tables]);

    const decorated = useMemo(() => {
        return (tables || []).map((t) => {
            const floor = floorState(t);
            const listOrder = byTable[t.id] || null;
            const attentionOrder = activeAttentionOrder(t, orders);
            const displayOrder = t.active_order || attentionOrder || listOrder || null;
            const serviceOrder = t.active_attention_id ? attentionOrder : (listOrder || t.active_order || null);
            const items = serviceOrder?.items || [];
            const ready = itemQty(items, (it) => it.status === 'listo');
            const pendingPrep = itemQty(items, (it) => !['entregado', 'cancelado', 'listo'].includes(it.status || 'pendiente'));
            const due = serviceOrder && serviceOrder.status !== 'cancelado'
                ? Math.max(0, Number(serviceOrder.total || 0) - Number(serviceOrder.amount_paid || 0))
                : 0;
            const billRequested = Boolean(serviceOrder?.payment_requested) || serviceOrder?.status === 'pendiente_pago';
            const showVisitaActiva = Boolean(t.active_attention_id) && !attentionOrder && Boolean(listOrder);
            const group = t.group || null;
            // A joined group reports how many bills it holds: with two, the
            // card must not pretend there is a single account.
            const groupBadge = group
                ? {
                    label: groupLabel(group, tables),
                    accounts: groupAccountTables(group, tables, activeOrders).length,
                }
                : null;
            const groupNumbers = group ? groupMembers(group, tables).map((m) => m.number) : null;
            return {
                table: t, floor, displayOrder, serviceOrder, ready, pendingPrep, due, billRequested,
                showVisitaActiva, group, groupBadge, groupNumbers,
            };
        });
    }, [tables, byTable, orders, activeOrders]);

    // Unidades del piso: una mesa individual = una tarjeta; un grupo = UNA
    // tarjeta grande con mesa principal + mini-mesas (igual que el prototipo).
    const units = useMemo(() => {
        const byGroup = new Map();
        const singles = [];
        for (const entry of decorated) {
            const gid = entry.group?.id;
            if (gid) {
                if (!byGroup.has(gid)) byGroup.set(gid, []);
                byGroup.get(gid).push(entry);
            } else {
                singles.push(entry);
            }
        }
        const groupUnits = [...byGroup.values()].map((members) => {
            members.sort((a, b) => Number(a.table.number) - Number(b.table.number));
            const group = members[0].group;
            const anchor = members.find((m) => m.table.id === group.anchor_table_id) || members[0];
            const floor = groupFloorState(members);
            const numbers = members.map((m) => Number(m.table.number));
            const accounts = groupAccountTables(group, tables, activeOrders).length;
            const dueSum = members.reduce((s, m) => s + (m.due || 0), 0);
            const totalSum = members.reduce((s, m) => s + (Number(m.serviceOrder?.total) || Number(m.displayOrder?.total) || 0), 0);
            const amount = dueSum > 0 ? `Debe ${fmtMoney(dueSum)}` : (totalSum > 0 ? fmtMoney(totalSum) : null);
            const maxCreated = members.reduce((acc, m) => {
                const iso = m.displayOrder?.created_at || m.serviceOrder?.created_at || null;
                if (!iso) return acc;
                return (!acc || new Date(iso) > new Date(acc)) ? iso : acc;
            }, null);
            const minutes = elapsedMinutes(maxCreated);
            const urgency = minutes >= 45 ? 'bad' : minutes >= 30 ? 'warn' : null;
            return {
                type: 'group', group, members, anchor, floor, numbers, accounts, amount,
                elapsed: maxCreated ? fmtElapsed(maxCreated) : null, minutes, urgency,
                isLate: floor.key === 'cuenta' && urgency === 'bad',
                anchorNumber: Number(anchor.table.number),
            };
        });
        return [
            ...singles.map((entry) => ({ type: 'single', entry, floor: entry.floor, anchorNumber: Number(entry.table.number) })),
            ...groupUnits,
        ];
    }, [decorated, tables, activeOrders]);

    // Conteos por estado para los filtros: cuentan tarjetas (una por unidad),
    // de modo que "Todas" refleja lo que se ve en pantalla.
    const stateCounts = useMemo(() => {
        const counts = { todas: units.length };
        for (const f of STATE_FILTERS) {
            if (f.key === 'todas') continue;
            const floors = STATE_FILTER_FLOORS[f.key] || [];
            counts[f.key] = units.filter((u) => floors.includes(u.floor.key)).length;
        }
        return counts;
    }, [units]);

    const filteredUnits = useMemo(() => {
        const list = units.filter((unit) => {
            const entries = unit.type === 'group' ? unit.members : [unit.entry];
            if (areaFilter !== 'todas' && !entries.some((e) => e.table.area === areaFilter)) return false;
            const key = unit.floor.key;
            if (stateFilter === 'libre' && key !== 'libre') return false;
            if (stateFilter === 'activas' && !['sentados', 'preparando', 'entregado', 'atencion'].includes(key)) return false;
            if (stateFilter === 'listo' && key !== 'listo') return false;
            if (stateFilter === 'cuenta' && key !== 'cuenta') return false;
            if (search && !entries.some((e) => `${e.table.number} ${e.table.name}`.toLowerCase().includes(search.toLowerCase()))) return false;
            return true;
        });
        // Fixed order by anchor number: the floor must not reshuffle on every
        // state change (it disorients the waiter mid-service). Urgency is shown
        // by colour, the state filters and the summary bar instead.
        return list.slice().sort((a, b) => a.anchorNumber - b.anchorNumber);
    }, [units, areaFilter, stateFilter, search]);

    // ── Actions ────────────────────────────────────────────────────────────
    const openSheet = async (t, preferredOrderId = null) => {
        // A joined table with no account of its own reads the group's account,
        // but only when the group holds exactly one: with two separate bills
        // there is nothing unambiguous to follow, so the sheet lists them.
        const groupOwners = t.group?.id ? groupAccountTables(t.group, tables, activeOrders) : [];
        const followed = groupOwners.length === 1 && groupOwners[0].id !== t.id && !t.active_order ? groupOwners[0] : null;
        const targetOrderId = preferredOrderId || t.active_order?.id || followed?.active_order?.id || null;
        setOpenTable({ table: t, order: null, history: null, group: t.group || null, accountTable: followed, loading: Boolean(targetOrderId), accounts: [], accountId: targetOrderId || null });
        if (targetOrderId) {
            try {
                const { data } = await api.get(`/orders/${targetOrderId}`);
                setOpenTable((s) => (s && s.table.id === t.id ? { ...s, order: data, loading: false } : s));
            } catch {
                setOpenTable((s) => (s && s.table.id === t.id ? { ...s, loading: false } : s));
            }
        }
        try {
            const { data } = await api.get('/orders', { params: { table_id: t.id, limit: 50 } });
            const all = data || [];
            const active = all.filter((o) => !['pagado', 'cancelado'].includes(o.status));
            const past = all.filter((o) => ['pagado', 'cancelado'].includes(o.status)).slice(0, 8);
            setOpenTable((s) => (s && s.table.id === t.id ? { ...s, accounts: active, history: past } : s));
            // Sin orden objetivo pero con cuentas abiertas: seguí la primera.
            if (!targetOrderId && active.length) await selectAccount(active[0].id);
        } catch { /* historial opcional */ }
    };

    const closeSheet = () => setOpenTable(null);
    const refreshAll = () => { refetchTables?.(); refetchOrders?.(); };

    // Multi-cuenta: cambia la cuenta activa que se muestra en el sheet.
    const selectAccount = async (orderId) => {
        setOpenTable((s) => (s ? { ...s, accountId: orderId, loading: true } : s));
        try {
            const { data } = await api.get(`/orders/${orderId}`);
            setOpenTable((s) => (s && s.accountId === orderId ? { ...s, order: data, loading: false } : s));
        } catch {
            setOpenTable((s) => (s ? { ...s, loading: false } : s));
        }
    };

    // Multi-cuenta: abre una cuenta adicional dentro de la misma visita.
    const addAccount = async () => {
        const t = openTable?.table;
        if (!t || !canTake) return;
        try {
            const { data } = await api.post('/orders', { table_id: t.id, order_type: 'mesa', new_account: true });
            toast.success('Cuenta agregada');
            // Queda seleccionada en el sheet: no se sale del salón.
            setOpenTable((s) => (s && s.table.id === t.id
                ? { ...s, order: data, accountId: data.id, accounts: [...(s.accounts || []), data] }
                : s));
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo agregar la cuenta');
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
                await api.post(`/orders/${targetId}/merge`, { source_order_id: o.id });
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
            await api.post(`/orders/${moveAccountId}/move`, { target_table_id: targetTableId });
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
            await api.post(`/orders/${targetId}/split`, { parts });
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
            const { data } = await api.get(`/orders/${orderId}`);
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
        const existing = s.order?.id || s.accountId || s.table?.active_order?.id || null;
        if (existing) return existing;
        const { data } = await api.post('/orders', { table_id: s.table.id, order_type: 'mesa' });
        setOpenTable((prev) => (prev && prev.table.id === s.table.id
            ? { ...prev, order: data, accountId: data.id, accounts: [...(prev.accounts || []), data] }
            : prev));
        return data.id;
    };

    const addProductToAccount = async (product) => {
        if (!canTake || savingItem) return;
        setSavingItem(true);
        try {
            const orderId = await ensureAccount();
            if (!orderId) return;
            await api.post(`/orders/${orderId}/items`, [{ product_id: product.id, quantity: 1 }]);
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
            if (next <= 0) await api.delete(`/orders/${orderId}/items/${item.id}`);
            else await api.patch(`/orders/${orderId}/items/${item.id}`, { quantity: next });
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar la cantidad');
        }
    };

    const sendCurrentToKitchen = async () => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake) return;
        try {
            await api.post(`/orders/${orderId}/send-to-kitchen`);
            toast.success('Enviado a cocina');
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar a cocina');
        }
    };

    // Alias opcional de la cuenta (identifica quién pidió; viaja a cocina).
    const saveAlias = async () => {
        const orderId = openTable?.order?.id || openTable?.accountId;
        if (!orderId || !canTake) return;
        try {
            await api.patch(`/orders/${orderId}/alias`, { alias: aliasDraft.trim() || null });
            await reloadCurrentOrder(orderId);
            refreshAll();
            toast.success('Alias guardado');
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar el alias');
        }
    };

    // "Tomar pedido" abre el sheet; la cuenta se crea al agregar el primer
    // producto. No navega a /pedidos.
    const takeOrderInline = async (t) => {
        if (!canTake) { toast.info('Solo el mozo puede tomar la mesa'); return; }
        if (t.status === 'pagada') { toast.info('Liberá la mesa pagada antes de tomar pedido'); return; }
        await openSheet(t);
    };

    const toggleSelected = (t) => {
        setSelected((ids) => (ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id]));
    };

    const startSelection = () => {
        setSelected([]);
        setSelectMode(true);
    };

    // Estable entre renders: el efecto del Esc la usa como dependencia.
    const cancelSelection = useCallback(() => {
        setSelectMode(false);
        setSelected([]);
    }, []);

    const joinTables = async () => {
        if (!canConfirmJoin || joining) return;
        setJoining(true);
        try {
            await api.post('/table-groups', { table_ids: selected });
            toast.success('Mesas unidas');
            cancelSelection();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudieron unir las mesas');
            refreshAll();
        } finally {
            setJoining(false);
        }
    };

    const dissolveGroup = async (group) => {
        if (!group?.id) return;
        try {
            await api.delete(`/table-groups/${group.id}`);
            toast.success('Mesas separadas');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudieron separar las mesas');
            refreshAll();
        }
    };

    const removeGroupMember = async (group, member) => {
        if (!group?.id || !member?.id) return;
        try {
            await api.delete(`/table-groups/${group.id}/tables/${member.id}`);
            toast.success(`Mesa ${member.number} separada`);
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo separar la mesa');
            refreshAll();
        }
    };

    const openTransfer = (t) => {
        const problem = transferProblem(t, activeOrders);
        if (problem) { toast.info(problem); return; }
        closeSheet();
        setTransferSource(t);
    };

    const moveVisit = async (target) => {
        if (!transferSource || movingVisit) return;
        setMovingVisit(true);
        try {
            const { data } = await api.post(`/tables/${transferSource.id}/transfer`, { target_table_id: target.id });
            toast.success(`Pedido movido a Mesa ${data?.to_number ?? target.number}`);
            setTransferSource(null);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo mover el pedido');
            refreshAll();
        } finally {
            setMovingVisit(false);
        }
    };

    // Charging leaves the floor: the cash screen owns the whole payment flow.
    const openCharge = (order) => {
        closeSheet();
        navigate(`/pedidos/${order.id}`);
    };

    const deliver = async (orderId) => {
        try {
            await api.post(`/orders/${orderId}/serve`);
            toast.success('Pedido entregado');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo entregar');
        }
    };

    const closeAttention = async (order) => {
        setClosing(order.id);
        try {
            await api.post(`/orders/${order.id}/attention/close`);
            toast.success('Atención cerrada');
            closeSheet();
            refreshAll();
        } catch (e) {
            refreshAll();
            toast.error(e.response?.data?.detail || 'No se pudo cerrar la atención. Puedes reintentar.');
        } finally {
            setClosing(null);
        }
    };

    const requestBill = async (order) => {
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'pendiente_pago' });
            toast.success('Cuenta solicitada');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo solicitar la cuenta');
        }
    };

    const releaseTable = async (t) => {
        if (!canTake) return;
        try {
            await api.post(`/tables/${t.id}/release`);
            toast.success(`Mesa ${t.number} libre`);
            closeSheet();
            refetchTables?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo liberar');
        }
    };

    const closeAreas = () => setShowNewOrder(false);

    // El botón "Nuevo pedido" abre el compositor con las pestañas de tipo.
    const openAreas = () => setShowNewOrder(true);

    // Elegir mesa en el compositor lleva al sheet de esa mesa (mismo panel).
    const pickTableForOrder = (t) => {
        closeAreas();
        void takeOrderInline(t);
    };

    const areaLabel = (a) => (a === 'todas' ? 'Todas las zonas' : a);

    // Atajo "/" para enfocar la búsqueda (igual que el prototipo de referencia).
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== '/') return;
            const el = document.activeElement;
            const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
            if (typing) return;
            e.preventDefault();
            searchRef.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // Esc sale del modo "unir mesas".
    useEffect(() => {
        if (!selectMode) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancelSelection(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [selectMode, cancelSelection]);

    // El alias del formulario sigue a la cuenta que se está viendo.
    useEffect(() => {
        setAliasDraft(openTable?.order?.customer_name || '');
    }, [openTable?.order?.id, openTable?.order?.customer_name]);

    return (
        <div className={selectMode ? 'space-y-5 pb-28' : 'space-y-5'} data-testid="salon-root">
            {/* Header + summary */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Salón</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
                        <Grid2X2 className="h-6 w-6 text-primary" /> Salón
                    </h1>
                    <p className="text-sm text-muted-foreground" data-testid="salon-resumen">
                        En cocina: {summary.toPrep} · Listos: {summary.toReady} · Por cobrar: {summary.toPay}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input ref={searchRef} className="pl-9 h-10 w-44" placeholder="Buscar mesa  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="salon-search-input" />
                    </div>
                    {summary.toPrep > 0 && (
                        <Button variant="outline" className="h-10" onClick={() => navigate('/cocina')} data-testid="salon-ir-cocina">
                            Cocina ({summary.toPrep})
                        </Button>
                    )}
                    {canTake && !selectMode && (
                        <>
                            <Button variant="outline" onClick={startSelection} className="h-10" data-testid="salon-unir-mesas">
                                <Link2 className="h-4 w-4 mr-1" /> Unir mesas
                            </Button>
                            <Button onClick={() => openAreas()} className="h-10" data-testid="salon-nuevo-pedido">
                                <ShoppingCart className="h-4 w-4 mr-1" /> Nuevo pedido
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Join mode: bottom action bar (thumb-friendly, like the reference prototype) */}
            {selectMode && (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.10)]" data-testid="salon-seleccion">
                    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
                        <div className="min-w-[200px] flex-1">
                            <span className="text-sm font-medium" data-testid="salon-seleccion-resumen">
                                {selected.length === 0
                                    ? 'Elegí dos o más mesas para unirlas'
                                    : `Elegidas: ${(tables || []).filter((t) => selected.includes(t.id)).sort((a, b) => Number(a.number) - Number(b.number)).map((t) => t.number).join(' + ')}`}
                            </span>
                            {selectionIssue && (
                                <span className="block text-xs text-destructive" data-testid="salon-seleccion-aviso">{selectionIssue}</span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" className="h-10" onClick={cancelSelection} data-testid="salon-seleccion-cancelar">
                                Cancelar
                            </Button>
                            <Button className="h-10" disabled={!canConfirmJoin || joining} onClick={joinTables} data-testid="salon-unir-confirmar">
                                <Link2 className="h-4 w-4 mr-1" /> {joining ? 'Uniendo…' : 'Unir mesas'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* State filter */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-testid="salon-filtros">
                {STATE_FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => setStateFilter(f.key)}
                        data-testid={`salon-filtro-${f.key}`}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${stateFilter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {f.label} <span className="ml-1.5 text-xs opacity-70 tabular-nums">{stateCounts[f.key]}</span>
                    </button>
                ))}
            </div>

            {/* Zones + legend */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                {areas.map((a) => (
                    <button
                        key={a}
                        type="button"
                        onClick={() => setAreaFilter(a)}
                        data-testid={`mesas-area-${a}`}
                        className={`shrink-0 px-3 py-1.5 rounded-sm text-sm font-medium transition-colors border ${areaFilter === a ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {areaLabel(a)}
                    </button>
                ))}
                <div className="flex flex-wrap gap-2 items-center lg:ml-auto" data-testid="salon-legend">
                    {LEGEND.map((k) => {
                        const s = FLOOR_STYLE[k];
                        return (
                            <span key={k} className="text-xs px-2 py-1 rounded-full border flex items-center gap-1.5 shrink-0" style={{ background: s.bg, borderColor: s.border, color: s.fg }}>
                                <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
                                {s.label}
                            </span>
                        );
                    })}
                </div>
            </div>

            {(tablesError || ordersError) && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <span className="font-medium">No se pudo actualizar el salón: las mesas y los pedidos pueden estar desactualizados.</span>
                    <Button variant="outline" className="h-11" onClick={() => { refetchTables(); refetchOrders(); }}>Reintentar</Button>
                </div>
            )}

            <div role="status" aria-live="polite" className="sr-only">{floorSummary}</div>

            {/* Floor grid */}
            {tablesLoading && !tables ? (
                // Reserva la rejilla mientras llegan las mesas: sin esto la
                // grilla aparece entera tras la respuesta (CLS 0,56).
                <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" data-testid="salon-skeleton" aria-hidden="true">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <Skeleton key={i} className="h-32 rounded-xl" />
                    ))}
                </div>
            ) : filteredUnits.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground border rounded-xl">
                    {tablesLoading && !tables ? 'Cargando mesas…' : 'No hay mesas con esos filtros.'}
                </div>
            ) : (
                <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {/* The card shortcut for taking an order opens the same sales-area
                        decision as the sheet, so no table is seated before the waiter
                        picks mesa / llevar / recojo / delivery. */}
                    {filteredUnits.map((unit) => (
                        unit.type === 'group' ? (
                            <GroupCard
                                key={unit.group.id}
                                unit={unit}
                                canServe={canServe}
                                canCharge={canCharge}
                                selectMode={selectMode}
                                onOpen={() => openSheet(unit.anchor.table)}
                                onOpenMember={(table) => openSheet(table)}
                                onDeliver={deliver}
                                onCharge={openCharge}
                            />
                        ) : (
                            <MesaCard
                                key={unit.entry.table.id}
                                item={unit.entry}
                                branchNames={branchNames}
                                canServe={canServe}
                                canCharge={canCharge}
                                canClose={canClose}
                                canTake={canTake}
                                closing={closing}
                                selectMode={selectMode}
                                picked={selected.includes(unit.entry.table.id)}
                                onSelect={toggleSelected}
                                onOpen={openSheet}
                                onDeliver={deliver}
                                onCharge={openCharge}
                                onCloseAttention={closeAttention}
                                onTake={takeOrderInline}
                            />
                        )
                    ))}
                </div>
            )}

            {/* Pickups (takeout) */}
            {pickupProjection.active.length > 0 && (
                <section className="rounded-md border border-border bg-card/50 p-3" data-testid="servicio-recojos-activos">
                    <h2 className="font-semibold">Recojos activos · {pickupProjection.active.length}</h2>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pickupProjection.active.map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 rounded-sm border border-border p-3" data-testid={`servicio-recojo-${order.id}`}>
                                <div>
                                    <p className="font-medium">{order.order_number ? `Pedido #${order.order_number}` : 'Pedido'}</p>
                                    <AttentionReference order={order} branchNames={branchNames} />
                                    <p className="text-sm text-muted-foreground">{order.status === 'listo' ? 'Listo para recojo' : 'En preparación'}</p>
                                </div>
                                <a
                                    className="shrink-0 text-sm underline"
                                    href={`/pedidos/${order.id}`}
                                    onClick={(e) => { e.preventDefault(); navigate(`/pedidos/${order.id}`); }}
                                >
                                    Ver pedido
                                </a>
                            </div>
                        ))}
                    </div>
                </section>
            )}
            {pickupProjection.prior.length > 0 && (
                <details className="rounded-md border border-border bg-card/50 p-3" data-testid="servicio-dias-anteriores">
                    <summary className="cursor-pointer font-semibold">
                        Días anteriores · {pickupProjection.prior.length} recojo(s) listos
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pickupProjection.prior.map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 rounded-sm border border-border p-3" data-testid={`servicio-recojo-anterior-${order.id}`}>
                                <div>
                                    <p className="font-medium">{order.order_number ? `Pedido #${order.order_number}` : 'Pedido'}</p>
                                    <AttentionReference order={order} branchNames={branchNames} />
                                    <p className="text-sm text-muted-foreground">Listo para recojo</p>
                                </div>
                                <a
                                    className="shrink-0 text-sm underline"
                                    href={`/pedidos/${order.id}`}
                                    onClick={(e) => { e.preventDefault(); navigate(`/pedidos/${order.id}`); }}
                                >
                                    Ver pedido
                                </a>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Table detail sheet (secondary actions) */}
            <Sheet open={Boolean(openTable)} onOpenChange={(o) => { if (!o) closeSheet(); }}>
                <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" aria-describedby={undefined} data-testid="mesa-sheet">
                    {openTable && (() => {
                        const { table: t, history, loading, accountTable, accounts, accountId } = openTable;
                        const group = openTable.group || t.group || null;
                        const members = group ? groupMembers(group, tables) : [];
                        const groupAccounts = group ? groupAccountTables(group, tables, activeOrders) : [];
                        const order = sheetOrder;
                        const currentAccountId = order?.id || accountId || t.active_order?.id || null;
                        const floor = floorState(t);
                        const s = FLOOR_STYLE[floor.key];
                        const closeable = canClose && canCloseAttention(t, order);
                        const billRequested = Boolean(order?.payment_requested) || order?.status === 'pendiente_pago';
                        // Composición inline: se puede pedir mientras la mesa no esté cerrada.
                        const canCompose = canTake && ['disponible', 'ocupada'].includes(t.status);
                        const draft = Boolean(order) && order.status === 'nuevo';
                        const orderItems = (order?.items || []).filter((i) => i.status !== 'cancelado');
                        // Cuántos platos pidió la mesa en total (todas las cuentas):
                        // el mozo lo lee de un vistazo sin sumar cuentas a mano.
                        const tableQuantities = (accounts || []).flatMap((o) => o.items || [])
                            .filter((i) => i.status !== 'cancelado')
                            .reduce((acc, i) => {
                                const name = i.product_name || 'Producto';
                                acc[name] = (acc[name] || 0) + Number(i.quantity || 0);
                                return acc;
                            }, {});
                        return (
                            <>
                                {/* Título para lectores de pantalla: Radix lo exige en el diálogo. */}
                                <SheetTitle className="sr-only">Mesa {t.number}</SheetTitle>
                                <div className="p-5 border-b" style={{ background: s.bg }}>
                                    <p className="page-kicker" style={{ color: s.fg }}>Mesa {t.number} · {t.area}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="h-3 w-3 rounded-full" style={{ background: s.dot }} />
                                        <h2 className="font-display text-2xl font-semibold" style={{ color: s.fg }}>{s.label}</h2>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs mt-1" style={{ color: s.fg, opacity: 0.8 }}>
                                        <Users className="h-3.5 w-3.5" /> Capacidad {t.capacity} personas
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                    {t.active_order && loading && <div className="text-sm text-muted-foreground">Cargando pedido…</div>}
                                    {((accounts && accounts.length > 1) || (t.active_attention_id && canTake)) && (
                                        <div className="flex flex-wrap gap-1.5" data-testid="mesa-sheet-cuentas">
                                            {accounts.map((o) => (
                                                <button
                                                    key={o.id}
                                                    type="button"
                                                    onClick={() => selectAccount(o.id)}
                                                    data-testid={`mesa-sheet-cuenta-${o.order_number}`}
                                                    className={`rounded-lg border px-2 py-1 text-xs font-medium ${currentAccountId === o.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                                                >
                                                    {o.customer_name ? o.customer_name : `#${o.order_number}`} · {fmtMoney(o.total)}
                                                </button>
                                            ))}
                                            {t.active_attention_id && canTake && (
                                                <button
                                                    type="button"
                                                    onClick={addAccount}
                                                    data-testid="mesa-sheet-nueva-cuenta"
                                                    className="rounded-lg border border-dashed border-border px-2 py-1 text-xs font-medium hover:bg-secondary"
                                                >
                                                    <Plus className="h-3 w-3 inline mr-1" />Cuenta
                                                </button>
                                            )}
                                            {accounts.length > 1 && canTake && (
                                                <button
                                                    type="button"
                                                    onClick={mergeAccounts}
                                                    data-testid="mesa-sheet-fusionar-cuentas"
                                                    className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-secondary"
                                                >
                                                    <Link2 className="h-3 w-3 inline mr-1" />Fusionar
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {canTake && order && (
                                        <div className="space-y-1" data-testid="mesa-sheet-alias-row">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    className="h-9"
                                                    placeholder={accounts.length > 1 ? 'Alias (ej. Juan)' : 'Alias de la cuenta (opcional)'}
                                                    value={aliasDraft}
                                                    onChange={(e) => setAliasDraft(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') saveAlias(); }}
                                                    data-testid="mesa-sheet-alias"
                                                />
                                                <Button
                                                    size="sm"
                                                    className="h-9 shrink-0"
                                                    onClick={saveAlias}
                                                    disabled={aliasDraft.trim() === (order.customer_name || '')}
                                                    data-testid="mesa-sheet-alias-guardar"
                                                >
                                                    Guardar
                                                </Button>
                                            </div>
                                            {accounts.length > 1 && !order.customer_name && (
                                                <p className="text-xs text-muted-foreground" data-testid="mesa-sheet-alias-hint">
                                                    Poné un alias para reconocer esta cuenta y agregarle lo suyo.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {accounts.length > 1 && Object.keys(tableQuantities).length > 0 && (
                                        <div className="rounded-xl border p-3 space-y-1" data-testid="mesa-sheet-resumen">
                                            <div className="page-kicker">
                                                Resumen de la mesa · {Object.values(tableQuantities).reduce((a, b) => a + b, 0)} platos
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {Object.entries(tableQuantities).map(([name, qty]) => (
                                                    <span key={name} className="text-xs rounded-full border border-border px-2 py-0.5 tabular-nums">{qty}× {name}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <OrderComposer
                                        order={order}
                                        items={orderItems}
                                        products={products}
                                        categories={categories}
                                        savingItem={savingItem}
                                        canCompose={canCompose}
                                        showKitchen={draft && orderItems.length > 0}
                                        onAddProduct={addProductToAccount}
                                        onSendToKitchen={sendCurrentToKitchen}
                                    />
                                    {order && (
                                        <>
                                            <div className="text-sm text-muted-foreground space-y-1">
                                                <div>Pedido #{order.order_number} · {order.source === 'public' ? 'Carta web' : 'Salón'}</div>
                                                <AttentionReference order={order} branchNames={branchNames} />
                                                {order.customer_name && <div>Cliente: <span className="text-foreground">{order.customer_name}</span></div>}
                                                <div>Hace {fmtElapsed(order.created_at)} · {ORDER_STATUS_LABELS[order.status] || order.status}</div>
                                            </div>
                                            <OrderItems
                                                items={orderItems}
                                                canCompose={canCompose}
                                                total={order.total}
                                                onChangeQty={changeItemQty}
                                            />
                                        </>
                                    )}
                                    {!t.active_order && !canCompose && <p className="text-sm text-muted-foreground">Sin pedido activo en esta mesa.</p>}
                                    {accountTable && order && (
                                        <p className="text-sm font-medium" data-testid="mesa-sheet-cuenta-grupo">
                                            Cuenta de Mesa {accountTable.number}
                                        </p>
                                    )}
                                    {t.active_attention_id && order && (
                                        <p className="text-sm text-muted-foreground">La visita sigue abierta. Finalizala cuando el cobro y la entrega estén completos.</p>
                                    )}
                                    {group && (
                                        <div className="rounded-xl border p-3 space-y-2" data-testid="mesa-sheet-grupo">
                                            <div className="page-kicker">Mesas unidas</div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {members.map((member) => (
                                                    <span
                                                        key={member.id}
                                                        data-testid={`mesa-sheet-grupo-miembro-${member.number}`}
                                                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                                                        style={{ background: '#F3F0FF', borderColor: '#D9D2F0', color: '#3B2A66' }}
                                                    >
                                                        Mesa {member.number}
                                                        {groupAccounts.some((owner) => owner.id === member.id) && <span className="text-[10px] opacity-80">· cuenta</span>}
                                                        {member.id !== t.id && canTake && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeGroupMember(group, member)}
                                                                aria-label={`Separar Mesa ${member.number}`}
                                                                data-testid={`mesa-sheet-quitar-grupo-${member.number}`}
                                                                className="ml-0.5 rounded-full hover:bg-black/10 p-0.5"
                                                            >
                                                                <Unlink className="h-3 w-3" />
                                                            </button>
                                                        )}
                                                    </span>
                                                ))}
                                            </div>
                                            {groupAccounts.length > 0 && (
                                                <div className="space-y-1" data-testid="mesa-sheet-grupo-cuentas">
                                                    {groupAccounts.map((owner) => {
                                                        const ownerOrder = activeOrders[owner.id] || owner.active_order || null;
                                                        return (
                                                            <button
                                                                key={owner.id}
                                                                type="button"
                                                                onClick={() => { closeSheet(); navigate(`/pedidos/${ownerOrder.id}`); }}
                                                                data-testid={`mesa-sheet-grupo-cuenta-${owner.number}`}
                                                                className="w-full rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:bg-secondary"
                                                            >
                                                                <span className="font-medium">Mesa {owner.number}</span>
                                                                {ownerOrder?.order_number ? ` · #${ownerOrder.order_number}` : ''}
                                                                {ownerOrder?.total != null ? ` · ${fmtMoney(ownerOrder.total)}` : ''}
                                                                {owner.id === t.id ? ' · esta mesa' : ''}
                                                                <span className="float-right underline">Abrir</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            <p className="text-xs text-muted-foreground" data-testid="mesa-sheet-grupo-resumen">
                                                {groupAccounts.length === 0
                                                    ? 'Todavía no hay una cuenta abierta en el grupo: cada mesa puede pedir la suya.'
                                                    : groupAccounts.length === 1
                                                        ? `Cada mesa conserva su propia cuenta; por ahora hay una: la de Mesa ${groupAccounts[0].number}.`
                                                        : `Cada mesa conserva su propia cuenta: hay ${groupAccounts.length} cuentas separadas en el grupo.`}
                                            </p>
                                            <Button
                                                variant="outline"
                                                className="w-full"
                                                onClick={() => dissolveGroup(group)}
                                                disabled={!canTake}
                                                data-testid="mesa-sheet-separar-grupo"
                                            >
                                                <Unlink className="h-4 w-4 mr-1" /> Separar mesas
                                            </Button>
                                        </div>
                                    )}
                                    {history && history.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="page-kicker">Turnos anteriores</div>
                                            <div className="border rounded-xl divide-y">
                                                {history.map((o) => (
                                                    <div key={o.id} className="py-2 px-3 flex items-center justify-between gap-2 text-sm">
                                                        <div className="min-w-0">
                                                            <div className="font-medium truncate">#{o.order_number} · {ORDER_STATUS_LABELS[o.status] || o.status}</div>
                                                            <AttentionReference order={o} branchNames={branchNames} />
                                                            <div className="text-xs text-muted-foreground">{fmtDateTime(o.created_at)}</div>
                                                        </div>
                                                        <span className="font-mono font-semibold tabular-nums shrink-0">{fmtMoney(o.total)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="border-t p-4 space-y-2">
                                    {t.active_order ? (
                                        <>
                                            {floor.key === 'listo' && canServe && (
                                                <Button className="w-full h-12" onClick={() => deliver(currentAccountId)} data-testid="mesa-sheet-entregar">Entregar</Button>
                                            )}
                                            {closeable && (
                                                <Button variant="outline" className="w-full h-12" onClick={() => closeAttention(order)} disabled={closing === order.id} data-testid={`servicio-cerrar-sheet-${t.number}`}>
                                                    {closing === order.id ? 'Cerrando…' : 'Finalizar mesa'}
                                                </Button>
                                            )}
                                            {billRequested ? (
                                                <Button disabled variant="outline" className="w-full h-12" data-testid="mesa-sheet-cuenta-solicitada">
                                                    Cuenta solicitada
                                                </Button>
                                            ) : (
                                                ['listo', 'entregado'].includes(order?.status) && canTake && (
                                                    <Button variant="outline" className="w-full h-12" onClick={() => requestBill(order)} data-testid="mesa-sheet-solicitar-cuenta">
                                                        Solicitar cuenta
                                                    </Button>
                                                )
                                            )}
                                            <Button
                                                variant={floor.key === 'listo' ? 'outline' : 'default'}
                                                className="w-full h-12"
                                                onClick={() => { closeSheet(); navigate(`/pedidos/${currentAccountId}`); }}
                                                data-testid="mesa-sheet-ver-pedido"
                                            >
                                                {floor.key === 'listo' ? 'Ver pedido' : 'Abrir pedido'}
                                            </Button>
                                            {canTake && order && (order.items || []).filter((i) => i.status !== 'cancelado').length >= 2 && (
                                                <div className="flex gap-2">
                                                    <span className="text-xs text-muted-foreground self-center">Dividir:</span>
                                                    {[2, 3, 4].map((n) => (
                                                        <Button key={n} variant="outline" className="flex-1 h-11" onClick={() => splitAccount(n)} data-testid={`mesa-sheet-dividir-${n}`}>÷{n}</Button>
                                                    ))}
                                                </div>
                                            )}
                                            {canTake && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-12"
                                                    onClick={() => openTransfer(t)}
                                                    data-testid="mesa-sheet-mover-pedido"
                                                >
                                                    <MoveRight className="h-4 w-4 mr-1" /> Mover pedido a otra mesa
                                                </Button>
                                            )}
                                            {accounts.length > 1 && canTake && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-12"
                                                    onClick={() => setMoveAccountId(currentAccountId)}
                                                    data-testid="mesa-sheet-mover-cuenta"
                                                >
                                                    <MoveRight className="h-4 w-4 mr-1" /> Mover esta cuenta a otra mesa
                                                </Button>
                                            )}
                                        </>
                                    ) : accountTable && order ? (
                                        <>
                                            <Button
                                                className="w-full h-12"
                                                onClick={() => { closeSheet(); navigate(`/pedidos/${order.id}`); }}
                                                data-testid="mesa-sheet-ver-pedido-grupo"
                                            >
                                                Ver pedido de Mesa {accountTable.number}
                                            </Button>
                                            {canTake && (
                                                <Button
                                                    variant="outline"
                                                    className="w-full h-12"
                                                    onClick={() => takeOrderInline(t)}
                                                    data-testid="mesa-sheet-pedir-grupo"
                                                >
                                                    <Plus className="h-4 w-4 mr-1" /> Pedir para Mesa {t.number} (cuenta aparte)
                                                </Button>
                                            )}
                                        </>
                                    ) : t.status === 'pagada' ? (
                                        <Button className="w-full h-12" variant="outline" onClick={() => releaseTable(t)} disabled={!canTake} data-testid="mesa-sheet-liberar">
                                            Liberar mesa
                                        </Button>
                                    ) : t.status === 'disponible' ? (
                                        <Button className="w-full h-12" onClick={() => takeOrderInline(t)} disabled={!canTake} data-testid="mesa-sheet-tomar">
                                            <Plus className="h-4 w-4 mr-1" /> Tomar mesa y pedir
                                        </Button>
                                    ) : t.status === 'ocupada' ? (
                                        <Button className="w-full h-12" onClick={() => takeOrderInline(t)} disabled={!canTake} data-testid="mesa-sheet-tomar-pedido">
                                            Tomar pedido
                                        </Button>
                                    ) : null}
                                </div>
                            </>
                        );
                    })()}
                </SheetContent>
            </Sheet>

            {/* Nuevo pedido: un solo compositor para las cuatro áreas de venta */}
            <NewOrderSheet
                open={showNewOrder}
                onOpenChange={(open) => { if (!open) closeAreas(); }}
                tables={tables}
                products={products}
                categories={categories}
                canTake={canTake}
                onPickTable={pickTableForOrder}
                onCreated={refreshAll}
            />

            {/* Move an open visit to another free table of the same branch */}
            <Dialog open={Boolean(transferSource)} onOpenChange={(open) => { if (!open) setTransferSource(null); }}>
                <DialogContent className="sm:max-w-lg" data-testid="mover-pedido">
                    <DialogHeader>
                        <DialogTitle className="font-display text-2xl">Mover pedido</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {transferSource && (
                            <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-testid="mover-pedido-origen">
                                Mesa <strong>{transferSource.number}</strong> → elegí la mesa destino.
                                El pedido y su visita se mueven completos; Mesa {transferSource.number} queda libre.
                            </div>
                        )}
                        {transferTargets.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4" data-testid="mover-pedido-sin-mesas">
                                No hay mesas libres de la misma sucursal para mover el pedido.
                            </p>
                        ) : (
                            <div className="grid grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto" data-testid="mover-pedido-mesas">
                                {transferTargets.map((target) => (
                                    <button
                                        key={target.id}
                                        type="button"
                                        onClick={() => moveVisit(target)}
                                        disabled={movingVisit}
                                        data-testid={`mover-pedido-mesa-${target.number}`}
                                        className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-60"
                                    >
                                        <span className="font-display text-2xl font-bold">{target.number}</span>
                                        <span className="text-xs text-muted-foreground mt-1">{target.area}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTransferSource(null)} data-testid="mover-pedido-cancelar">
                            {movingVisit ? 'Moviendo…' : 'Cancelar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Move one account to another free table */}
            <Dialog open={Boolean(moveAccountId)} onOpenChange={(open) => { if (!open) setMoveAccountId(null); }}>
                <DialogContent className="sm:max-w-lg" data-testid="mover-cuenta">
                    <DialogHeader>
                        <DialogTitle className="font-display text-2xl">Mover cuenta</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {(() => {
                            const targets = (tables || []).filter((t) => (
                                t.status === 'disponible' && !t.active_order && !t.active_attention_id && t.id !== openTable?.table?.id
                            ));
                            return targets.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4" data-testid="mover-cuenta-sin-mesas">
                                    No hay mesas libres para mover la cuenta.
                                </p>
                            ) : (
                                <div className="grid grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto" data-testid="mover-cuenta-mesas">
                                    {targets.map((target) => (
                                        <button
                                            key={target.id}
                                            type="button"
                                            onClick={() => moveAccount(target.id)}
                                            data-testid={`mover-cuenta-mesa-${target.number}`}
                                            className="flex flex-col items-center justify-center p-4 rounded-lg border-2 border-border hover:border-primary hover:bg-primary/5 transition-colors"
                                        >
                                            <span className="font-display text-2xl font-bold">{target.number}</span>
                                            <span className="text-xs text-muted-foreground mt-1">{target.area}</span>
                                        </button>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMoveAccountId(null)} data-testid="mover-cuenta-cancelar">
                            Cancelar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
