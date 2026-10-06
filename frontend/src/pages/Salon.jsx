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
import OrderComposer from '@/components/OrderComposer';
import PersonChips from '@/components/PersonChips';
import { PersonOrderSummary, TableReceipt, TableSummary } from '@/components/OrderSummary';
import { draftCount, isDraft, personLabel, sendAction, tableSummary, itemsTotal } from '@/lib/orderDraft';
import NewOrderSheet from '@/components/NewOrderSheet';
import { Search, Grid2X2, Plus, Users, ShoppingCart, Link2, Unlink, MoveRight } from 'lucide-react';
import MoreActions from '@/components/MoreActions';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { hasFn } from '@/lib/functions';
import {
    branchScopeParams,
    readRememberedScope,
    rememberScope,
    resolveBranchScope,
} from '@/lib/branchScope';
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

/** Un ítem sigue "en cocina" mientras no esté entregado ni anulado. */
const itemPending = (it) => !['entregado', 'cancelado'].includes(it.status || 'pendiente');

/**
 * Estados agregados de los platos de una cuenta, en el orden en que reclaman
 * acción: lo listo se sirve antes de enviar nada nuevo, y lo que ya salió no
 * cuenta para ninguna acción.
 */
function accountTally(order) {
    const items = (order?.items || []).filter((it) => it.status !== 'cancelado');
    return {
        ready: itemQty(items, (it) => it.status === 'listo'),
        drafts: itemQty(items, itemPending),
        kitchen: itemQty(items, (it) => ['pendiente', 'enviado_cocina', 'en_preparacion'].includes(it.status)),
        served: itemQty(items, (it) => it.status === 'entregado'),
    };
}

/** Texto corto del estado agregado ("Listo para servir · 2"). */
function tallyLabel(tally) {
    if (tally.ready > 0) return `Listo para servir · ${tally.ready}`;
    if (tally.drafts > 0) return `Por enviar · ${tally.drafts}`;
    if (tally.kitchen > 0) return `En cocina · ${tally.kitchen}`;
    if (tally.served > 0) return `Servido · ${tally.served}`;
    return 'Sin platos todavía';
}

/**
 * Padding inferior del contenido cuando la barra fija del pedido activo está
 * visible.
 *
 * `!` (important) es deliberado: el hueco normal de la barra de navegación lo
 * pone `.has-bottom-nav`, que vive en la capa `components` y le gana a
 * cualquier utilidad `pb-*` de la capa `utilities`. Con `md:!pb-0` se devuelve
 * el hueco al shell en escritorio, donde el mini va pegado al borde inferior.
 */
const MINI_OPEN_CLASS = 'pb-44 md:!pb-0';

/**
 * Una cuenta sigue siendo el pedido a medio armar mientras nada haya salido a
 * cocina: sus productos están en borrador. Recién al enviarla se convierte en
 * una persona de la mesa, sin que el mozo "abra" nada.
 *
 * El alias no cuenta: se puede escribir (y guardar) antes de enviar, y eso no
 * convierte el borrador en una persona.
 */
function isComposingDraft(order) {
    if (!order) return false;
    return !(order.items || []).some((item) => !isDraft(item, order.status));
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
    // Mensaje de confirmación tras enviar: "✓ Pedido de Juan enviado.
    // ¿Siguiente persona?" — la pantalla queda limpia para la siguiente.
    const [flash, setFlash] = useState(null);
    // Interruptor de la cuenta compartida de la mesa (la fuente, la jarra).
    const [sharedDraft, setSharedDraft] = useState(false);
    const [receiptOpen, setReceiptOpen] = useState(false);
    // Última cuenta abierta en la hoja: alimenta el mini-reproductor del pedido
    // activo. Se guarda la mesa en mano (no solo el id) para poder reabrir la
    // hoja sin depender de que la mesa siga en el listado del polling.
    const [lastOpened, setLastOpened] = useState(null);
    // Alcance por sucursal del piso. El dueño ve todo el negocio, así que elige
    // qué salón mira; el resto del personal queda fijado por el servidor.
    const [branchCatalog, setBranchCatalog] = useState({ loading: false, error: false, branches: [], resolved: false });
    const [scope, setScope] = useState(null);
    const searchRef = useRef(null);

    const isOwner = user?.role === 'admin' || hasFn(user, 'administracion');

    useEffect(() => {
        if (!isOwner) {
            setBranchCatalog({ loading: false, error: false, branches: [], resolved: true });
            setScope(null);
            return undefined;
        }
        let active = true;
        setBranchCatalog((current) => ({ ...current, loading: true, error: false }));
        api.get('/branches').then(({ data }) => {
            if (!active) return;
            const branches = Array.isArray(data) ? data : [];
            setBranchCatalog({ loading: false, error: false, branches, resolved: true });
            setScope(resolveBranchScope({
                isOwner: true,
                branches,
                remembered: readRememberedScope(user?.id),
            }));
        }).catch(() => {
            if (active) {
                // Sin catálogo no se puede elegir: el salón queda como estaba.
                setBranchCatalog({ loading: false, error: true, branches: [], resolved: true });
                setScope(null);
            }
        });
        return () => { active = false; };
    }, [isOwner, user?.id]);

    const scopeParams = useMemo(() => branchScopeParams(scope), [scope]);
    const scopeKey = scope || 'sin-alcance';
    // Quien elige piso espera a su catálogo: hasta entonces no se pide ninguno,
    // para no mostrar todas las sucursales mezcladas ni un instante.
    const scopePending = isOwner && !branchCatalog.resolved;
    const chooseScope = (next) => {
        setScope(next);
        rememberScope(user?.id, next);
    };

    const { data: tables, error: tablesError, loading: tablesLoading, refetch: refetchTables } = usePolling(
        // Sin sucursal elegida el pedido va sin parámetros: el servidor ya acota
        // a la sucursal del usuario.
        () => (scopePending
            ? Promise.resolve(null)
            : (scopeParams ? api.get('/tables', { params: scopeParams }) : api.get('/tables'))).then((r) => (r ? r.data : null)),
        8000,
        [generation, scopeKey, scopePending]
    );
    const { data: liveOrders, error: ordersError, refetch: refetchOrders } = usePolling(
        () => (scopePending
            ? Promise.resolve(null)
            : (scopeParams
                ? api.get('/orders', { params: { active_only: true, ...scopeParams } })
                : api.get('/orders', { params: { active_only: true } }))).then((r) => (r ? r.data : null)),
        8000,
        [generation, scopeKey, scopePending]
    );
    const orders = useMemo(() => (Array.isArray(liveOrders) ? liveOrders : []), [liveOrders]);

    // Mesas que ningún salón muestra porque no tienen sucursal guardada. Es una
    // lectura de administración y a un ritmo más lento: sirve para avisar, no
    // para operar el piso.
    const { data: unassigned } = usePolling(
        () => (isOwner && !scopePending && scope !== 'legacy'
            ? api.get('/tables', { params: { legacy_only: true } }).then((r) => r.data)
            : Promise.resolve(null)),
        30000,
        [generation, isOwner, scopeKey, scopePending]
    );
    const unassignedCount = Array.isArray(unassigned) ? unassigned.length : 0;

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
        // `t.area` puede venir vacío (mesas antiguas sin zona). Sin filtrar, la
        // fila de zonas pintaba un chip "undefined" y React avisaba de una clave
        // ausente en la lista (`key={undefined}` no cuenta como clave).
        const s = new Set((tables || []).map((t) => t.area).filter(Boolean));
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
        const { data } = await api.post('/orders', payload);
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
            await api.patch(`/orders/${orderId}/items/${item.id}`, { notes });
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
            await api.post(`/orders/${orderId}/items/${item.id}/void`, { reason });
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
        await api.patch(`/orders/${orderId}/alias`, { alias: nextName || null, shared: sharedDraft });
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
                await api.post(`/orders/${orderId}/items`, [{ product_id: item.product_id, quantity: 1, notes: note }]);
                await api.patch(`/orders/${orderId}/items/${item.id}`, { quantity: Number(item.quantity) - 1 });
            } else {
                await api.patch(`/orders/${orderId}/items/${item.id}`, { notes: note });
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
            await api.post(`/orders/${orderId}/items/${item.id}/move`, { target_order_id: targetOrderId });
            toast.success('Producto movido de persona');
            await reloadCurrentOrder(orderId);
            refreshAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo mover el producto');
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
        if (!targetId || !canTake) return;
        const openId = openTable?.order?.id || openTable?.accountId;
        try {
            // El alias viaja con la comanda: se guarda acá, sin botón aparte.
            if (targetId === openId) await persistAlias(targetId);
            const { data } = await api.post(`/orders/${targetId}/send-to-kitchen`);
            const pending = draftCount(sendItemsFor(targetId), data?.status);
            const who = data?.customer_name || (data?.shared ? 'Compartido' : 'la persona');
            toast.success(pending > 0 ? `Enviados ${pending} adicionales` : 'Enviado a cocina');
            await reloadCurrentOrder(targetId);
            if (targetId === openId) {
                // La persona ya quedó registrada: la pantalla se limpia sola para
                // la siguiente, que es como el mozo trabaja de verdad.
                setFlash(`✓ Pedido de ${who} enviado. ¿Siguiente persona?`);
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

    // Los platos de una cuenta concreta, para saber cuántos adicionales viajaron.
    const sendItemsFor = (orderId) => {
        const account = (openTable?.accounts || []).find((o) => o.id === orderId);
        return (account || sheetOrder || {}).items || [];
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
            const { data } = await api.post('/table-groups', { table_ids: selected });
            const groupId = data?.id || data?.group?.id || null;
            // Unir mesas tiene inversa fiel: la misma disolución que ya usa la
            // hoja (`DELETE /table-groups/:id`). Solo se ofrece si la API
            // devolvió el grupo; sin id no se puede deshacer y no se promete.
            if (groupId) {
                toast.success('Mesas unidas', {
                    duration: 8000,
                    action: {
                        label: 'Deshacer',
                        onClick: async () => {
                            try {
                                await api.delete(`/table-groups/${groupId}`);
                                toast.success('Mesas separadas');
                            } catch (e) {
                                toast.error(e.response?.data?.detail || 'No se pudieron separar las mesas');
                            } finally {
                                refreshAll();
                            }
                        },
                    },
                });
            } else {
                toast.success('Mesas unidas');
            }
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

    // La cuenta puede haberse cerrado, cobrado o movido desde el último vistazo:
    // el mini solo vive mientras el pedido siga abierto en la lista viva.
    const miniOrder = useMemo(() => {
        if (!lastOpened) return null;
        const live = orders.find((o) => o.id === lastOpened.accountId && o.table_id === lastOpened.tableId);
        const order = live || lastOpened.account;
        if (!order || ['pagado', 'cancelado'].includes(order.status)) return null;
        return order;
    }, [orders, lastOpened]);

    const miniVisible = Boolean(miniOrder) && !openTable && !showNewOrder && !transferSource
        && !moveAccountId && !selectMode;

    return (
        <div
            className={`space-y-5 ${selectMode ? 'pb-28' : ''} ${miniVisible ? MINI_OPEN_CLASS : ''}`}
            data-testid="salon-root"
        >
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
                    {isOwner && branchCatalog.branches.length > 0 && (
                        <select
                            aria-label="Sucursal del salón"
                            data-testid="salon-sucursal"
                            className="h-11 rounded-sm border border-input bg-background px-3 text-sm sm:h-10"
                            value={scope || ''}
                            onChange={(e) => chooseScope(e.target.value)}
                            disabled={branchCatalog.loading}
                        >
                            {branchCatalog.branches.map((branch) => (
                                <option key={branch.id} value={`branch:${branch.id}`}>{branch.name}</option>
                            ))}
                            <option value="legacy">Sin sucursal</option>
                        </select>
                    )}
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3.5 sm:top-3 text-muted-foreground" />
                        <Input ref={searchRef} className="pl-9 w-44" placeholder="Buscar mesa  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="salon-search-input" />
                    </div>
                    {summary.toPrep > 0 && (
                        <Button variant="outline" onClick={() => navigate('/cocina')} data-testid="salon-ir-cocina">
                            Cocina ({summary.toPrep})
                        </Button>
                    )}
                    {canTake && !selectMode && (
                        <>
                            <Button variant="outline" onClick={startSelection} data-testid="salon-unir-mesas">
                                <Link2 className="h-4 w-4 mr-1" /> Unir mesas
                            </Button>
                            <Button onClick={() => openAreas()} data-testid="salon-nuevo-pedido">
                                <ShoppingCart className="h-4 w-4 mr-1" /> Nuevo pedido
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Join mode: bottom action bar (thumb-friendly). En móvil sube por
                encima de la barra de navegación inferior: las dos están en z-40. */}
            {selectMode && (
                <div className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] z-40 border-t bg-card px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.10)] md:bottom-0" data-testid="salon-seleccion">
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
                            <Button variant="outline" onClick={cancelSelection} data-testid="salon-seleccion-cancelar">
                                Cancelar
                            </Button>
                            <Button disabled={!canConfirmJoin || joining} onClick={joinTables} data-testid="salon-unir-confirmar">
                                <Link2 className="h-4 w-4 mr-1" /> {joining ? 'Uniendo…' : 'Unir mesas'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* State filter */}
            <div className="scroll-x flex gap-2 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-testid="salon-filtros">
                {STATE_FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => setStateFilter(f.key)}
                        data-testid={`salon-filtro-${f.key}`}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${stateFilter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {f.label} <span className="ml-1.5 text-xs tabular-nums">{stateCounts[f.key]}</span>
                    </button>
                ))}
            </div>

            {/* Zones as a segmented control: same behaviour and same testids as
                the old chip row, but the active zone reads as a pressed segment
                (aria-pressed) inside a labelled group, instead of a run of
                independent pills. Still a horizontal scroller at 360 px. */}
            <div
                role="group"
                aria-label="Zona de la mesa"
                data-testid="salon-zonas"
                className="scroll-x sm:overflow-visible sm:pb-0"
            >
                <div className="inline-flex w-max gap-1 rounded-sm border border-border bg-secondary/60 p-1 sm:w-auto sm:flex-wrap">
                    {areas.map((a) => (
                        <button
                            key={a}
                            type="button"
                            onClick={() => setAreaFilter(a)}
                            aria-pressed={areaFilter === a}
                            data-testid={`mesas-area-${a}`}
                            className={`shrink-0 min-h-touch rounded-sm px-3 text-sm font-medium transition-colors sm:min-h-9 ${areaFilter === a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            {areaLabel(a)}
                        </button>
                    ))}
                </div>
            </div>

            {/* La leyenda va en su propia fila: dentro del carril con scroll
                quedaba a la derecha, fuera de la vista en móvil. Es una clave,
                no un control, así que se compacta al máximo: con padding de
                píldora ocupaba 94 px en 360 px (tres filas) y empujaba la
                primera mesa hasta el píxel 525 de 640. */}
            <div className="flex w-full flex-wrap gap-1 items-center lg:justify-end" data-testid="salon-legend">
                {LEGEND.map((k) => {
                    const s = FLOOR_STYLE[k];
                    return (
                        <span key={k} className="text-xs px-1.5 py-0.5 rounded-full border flex items-center gap-1 shrink-0" style={{ background: s.bg, borderColor: s.border, color: s.fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
                            {s.label}
                        </span>
                    );
                })}
            </div>

            {(tablesError || ordersError) && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <span className="font-medium">No se pudo actualizar el salón: las mesas y los pedidos pueden estar desactualizados.</span>
                    <Button variant="outline" className="h-11" onClick={() => { refetchTables(); refetchOrders(); }}>Reintentar</Button>
                </div>
            )}

            {isOwner && branchCatalog.error && (
                <p role="alert" className="text-sm text-destructive" data-testid="salon-sucursales-error">
                    No se pudieron cargar las sucursales: el salón está mostrando todas las mesas del negocio.
                </p>
            )}

            {/* Una mesa sin sucursal no pertenece a ningún salón: si el dueño no
                se entera acá, parece que desapareció del piso. */}
            {isOwner && scope && scope !== 'legacy' && unassignedCount > 0 && (
                <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
                    data-testid="salon-mesas-sin-sucursal"
                >
                    <span className="font-medium">
                        {unassignedCount === 1
                            ? '1 mesa sin sucursal no aparece en ningún salón.'
                            : `${unassignedCount} mesas sin sucursal no aparecen en ningún salón.`}
                    </span>
                    <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => navigate('/local?tab=mesas')}
                        data-testid="salon-ir-mesas-sin-sucursal"
                    >
                        Asignar sucursal
                    </Button>
                </div>
            )}

            <div role="status" aria-live="polite" className="sr-only">{floorSummary}</div>

            {/* Floor grid */}
            {!tables && (tablesLoading || scopePending) ? (
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
                        // Composición inline: se puede pedir mientras la mesa no esté cerrada.
                        const canCompose = canTake && ['disponible', 'ocupada'].includes(t.status);
                        const allItems = order?.items || [];
                        const orderItems = allItems.filter((i) => i.status !== 'cancelado');
                        // Qué ofrece el botón de envío: la comanda entera la primera
                        // vez, y después sólo los adicionales.
                        const sendState = order ? sendAction(allItems, order) : null;
                        const showSend = Boolean(sendState)
                            && (sendState.kind === 'extra' ? sendState.count > 0 : allItems.length > 0);
                        // Cada cuenta es una persona, pero sólo se muestra como tal
                        // cuando algo salió a cocina: mientras todo es borrador, es el
                        // "nuevo pedido" que el mozo todavía está armando.
                        const allAccounts = accounts || [];
                        const personAccounts = allAccounts.filter((o) => !isComposingDraft(activeOrders[o.id] || o));
                        const persons = personAccounts.map((o, index) => {
                            const detail = activeOrders[o.id] || o;
                            return {
                                id: o.id,
                                number: o.order_number,
                                label: personLabel(detail, index),
                                shared: Boolean(detail.shared),
                                draftCount: draftCount(detail.items || [], detail.status),
                            };
                        });
                        const summaryRows = tableSummary(allAccounts.map((o, index) => {
                            const detail = activeOrders[o.id] || o;
                            return { id: o.id, label: personLabel(detail, index), items: detail.items || [] };
                        }));
                        // Salen de las mismas filas que se despliegan, así el número
                        // de la barra nunca contradice el detalle.
                        const tableDishes = summaryRows.reduce((sum, row) => sum + row.quantity, 0);
                        const tableTotal = summaryRows.reduce((sum, row) => sum + row.subtotal, 0);
                        // Lo que falta enviar de la cuenta que se está armando.
                        const pendingCount = order ? draftCount(order.items || [], order.status) : 0;
                        // Con la pantalla limpia para la siguiente persona, las acciones
                        // de la mesa siguen apuntando a una cuenta real.
                        const fallbackPerson = persons[0] || null;
                        const actionOrder = order
                            || (fallbackPerson ? (activeOrders[fallbackPerson.id] || allAccounts.find((o) => o.id === fallbackPerson.id)) : null);
                        const actionAccountId = currentAccountId || fallbackPerson?.id || null;
                        // Con la pantalla limpia para la siguiente persona, las acciones
                        // de la mesa (entregar, cobrar, finalizar) siguen funcionando.
                        const closeable = canClose && canCloseAttention(t, actionOrder);
                        const billRequested = Boolean(actionOrder?.payment_requested) || actionOrder?.status === 'pendiente_pago';
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
                                    {/* El resumen va arriba y plegado: el mozo lo lee de
                                        reojo sin que le empuje la carta hacia abajo. */}
                                    <TableSummary
                                        rows={summaryRows}
                                        accounts={personAccounts.length}
                                        dishes={tableDishes}
                                        total={tableTotal}
                                        people={persons}
                                        canEdit={canCompose && persons.length > 1}
                                        onMoveItem={moveItemToPerson}
                                        onOpenReceipt={() => setReceiptOpen(true)}
                                    />
                                    {receiptOpen && (
                                        <TableReceipt
                                            table={t}
                                            rows={summaryRows}
                                            accounts={personAccounts.map((o, index) => {
                                                const detail = activeOrders[o.id] || o;
                                                return { id: o.id, label: personLabel(detail, index), total: itemsTotal(detail.items || []) };
                                            })}
                                            total={tableTotal}
                                            pending={pendingCount}
                                        />
                                    )}
                                    {flash && (
                                        <p
                                            className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary"
                                            role="status"
                                            data-testid="mesa-sheet-flash"
                                        >
                                            {flash}
                                        </p>
                                    )}
                                    {(canCompose || (accounts && accounts.length > 0)) && (
                                        <PersonChips
                                            people={persons}
                                            activeId={currentAccountId}
                                            onSelect={(id) => { setReceiptOpen(false); setFlash(null); selectAccount(id); }}
                                        />
                                    )}
                                    {canCompose && (
                                        <div className="space-y-1" data-testid="mesa-sheet-alias-row">
                                            {/* Sin botón de guardar: el alias se escribe y viaja
                                                con la comanda cuando el mozo envía el pedido. */}
                                            <div className="flex items-center gap-1.5">
                                                <Input
                                                    placeholder="Alias (opcional)"
                                                    value={aliasDraft}
                                                    onChange={(e) => setAliasDraft(e.target.value)}
                                                    onBlur={() => { if (order) saveAlias(); }}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') saveAlias(); }}
                                                    data-testid="mesa-sheet-alias"
                                                />
                                                {/* La fuente, la jarra, la entrada para compartir:
                                                    es de la mesa, no de una persona. */}
                                                <button
                                                    type="button"
                                                    onClick={() => setSharedDraft((cur) => !cur)}
                                                    aria-pressed={sharedDraft}
                                                    title="Lo que pide la mesa entera"
                                                    data-testid="mesa-sheet-compartido"
                                                    className={`flex h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                                                        sharedDraft
                                                            ? 'border-primary bg-primary text-primary-foreground'
                                                            : 'border-border text-muted-foreground hover:border-primary'
                                                    }`}
                                                >
                                                    🍽️ Compartido
                                                </button>
                                            </div>
                                            <p className="text-xs text-muted-foreground" data-testid="mesa-sheet-alias-hint">
                                                {persons.length > 0
                                                    ? 'Nuevo pedido: escribí un alias o tocá una persona para sumarle lo suyo.'
                                                    : 'El alias es opcional: sin él queda como Persona 1.'}
                                            </p>
                                            {/* Con una persona ya cargada a la vista, este es el
                                                camino de vuelta al pedido de la siguiente. */}
                                            {order && !isComposingDraft(order) && (
                                                <button
                                                    type="button"
                                                    onClick={startAnotherPerson}
                                                    data-testid="mesa-sheet-otra-persona"
                                                    className="min-h-9 w-full rounded-lg border border-dashed border-border px-3 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
                                                >
                                                    ＋ Pedido de otra persona
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <OrderComposer
                                        order={order}
                                        items={orderItems}
                                        products={products}
                                        categories={categories}
                                        savingItem={savingItem}
                                        canCompose={canCompose}
                                        showKitchen={showSend}
                                        sendLabel={sendState?.label}
                                        onAddProduct={addProductToAccount}
                                        onRemoveProduct={removeProductFromAccount}
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
                                            <p className="page-kicker" data-testid="mesa-sheet-items-titulo">
                                                {order.status === 'nuevo' ? 'Por enviar' : 'Lo de esta persona'}
                                            </p>
                                            <PersonOrderSummary
                                                items={allItems}
                                                orderStatus={order.status}
                                                canEdit={canCompose}
                                                saving={savingItem}
                                                onChangeQty={changeItemQty}
                                                onNotes={saveItemNotes}
                                                onApplyNote={applyItemNote}
                                                onVoid={voidProduct}
                                            />
                                            <div className="flex justify-between font-display text-lg font-bold">
                                                <span>Total</span>
                                                <span className="font-mono tabular-nums">{fmtMoney(order.total)}</span>
                                            </div>
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
                                                        {groupAccounts.some((owner) => owner.id === member.id) && <span className="text-xs text-muted-foreground">· cuenta</span>}
                                                        {member.id !== t.id && canTake && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeGroupMember(group, member)}
                                                                aria-label={`Separar Mesa ${member.number}`}
                                                                data-testid={`mesa-sheet-quitar-grupo-${member.number}`}
                                                                className="ml-0.5 grid min-h-touch min-w-touch place-items-center rounded-full hover:bg-black/10"
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
                                            {/* La barra tiene un lugar por tipo de acción:
                                                operar (Entregar), cerrar (Cuenta) y el resto
                                                en ⋯ Más. Así el cuerpo del modal queda para
                                                tomar pedidos, que es lo que más se hace. */}
                                            {floor.key === 'listo' && canServe && (
                                                <Button className="w-full h-12" onClick={() => deliver(actionAccountId)} data-testid="mesa-sheet-entregar">Entregar</Button>
                                            )}
                                            {/* Un solo lugar para cerrar: la etiqueta cambia
                                                con el momento de la visita en vez de sumar un
                                                botón por cada paso del cobro. */}
                                            {closeable ? (
                                                <Button variant="outline" className="w-full h-12" onClick={() => closeAttention(actionOrder)} disabled={closing === actionOrder?.id} data-testid={`servicio-cerrar-sheet-${t.number}`}>
                                                    {closing === actionOrder?.id ? 'Cerrando…' : 'Finalizar mesa'}
                                                </Button>
                                            ) : billRequested ? (
                                                <Button disabled variant="outline" className="w-full h-12" data-testid="mesa-sheet-cuenta-solicitada">
                                                    Cuenta solicitada
                                                </Button>
                                            ) : (
                                                ['listo', 'entregado'].includes(actionOrder?.status) && canTake && (
                                                    <Button variant="outline" className="w-full h-12" onClick={() => requestBill(actionOrder)} data-testid="mesa-sheet-solicitar-cuenta">
                                                        Solicitar cuenta
                                                    </Button>
                                                )
                                            )}
                                            <MoreActions
                                                testId="mesa-sheet-mas"
                                                actions={[
                                                    {
                                                        key: 'ver-pedido',
                                                        label: floor.key === 'listo' ? 'Ver pedido' : 'Abrir pedido',
                                                        testId: 'mesa-sheet-ver-pedido',
                                                        disabled: !actionAccountId,
                                                        onSelect: () => { closeSheet(); navigate(`/pedidos/${actionAccountId}`); },
                                                    },
                                                    ...(canTake && actionOrder && (actionOrder.items || []).filter((i) => i.status !== 'cancelado').length >= 2
                                                        ? [{ group: 'Dividir la cuenta' }, ...[2, 3, 4].map((n) => ({
                                                            key: `dividir-${n}`,
                                                            label: `En ${n} cuentas`,
                                                            testId: `mesa-sheet-dividir-${n}`,
                                                            onSelect: () => splitAccount(n),
                                                        }))]
                                                        : []),
                                                    ...(canTake ? [{
                                                        key: 'mover-pedido',
                                                        label: 'Mover pedido a otra mesa',
                                                        icon: MoveRight,
                                                        testId: 'mesa-sheet-mover-pedido',
                                                        onSelect: () => openTransfer(t),
                                                    }] : []),
                                                    ...(accounts.length > 1 && canTake ? [
                                                        {
                                                            key: 'mover-cuenta',
                                                            label: 'Mover esta cuenta a otra mesa',
                                                            icon: MoveRight,
                                                            testId: 'mesa-sheet-mover-cuenta',
                                                            onSelect: () => setMoveAccountId(actionAccountId),
                                                        },
                                                        {
                                                            key: 'fusionar-cuentas',
                                                            label: 'Fusionar cuentas',
                                                            icon: Link2,
                                                            testId: 'mesa-sheet-fusionar-cuentas',
                                                            onSelect: mergeAccounts,
                                                        },
                                                    ] : []),
                                                ]}
                                            />
                                        </>
                                    ) : accountTable && order ? (
                                        <>
                                            {canTake && (
                                                <Button
                                                    className="w-full h-12"
                                                    onClick={() => takeOrderInline(t)}
                                                    data-testid="mesa-sheet-pedir-grupo"
                                                >
                                                    <Plus className="h-4 w-4 mr-1" /> Pedir para Mesa {t.number} (cuenta aparte)
                                                </Button>
                                            )}
                                            <MoreActions
                                                testId="mesa-sheet-mas-grupo"
                                                actions={[{
                                                    key: 'ver-pedido-grupo',
                                                    label: `Ver pedido de Mesa ${accountTable.number}`,
                                                    testId: 'mesa-sheet-ver-pedido-grupo',
                                                    onSelect: () => { closeSheet(); navigate(`/pedidos/${order.id}`); },
                                                }]}
                                            />
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
                            <div className="grid grid-cols-3 gap-2 max-h-[50dvh] overflow-y-auto" data-testid="mover-pedido-mesas">
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
                                <div className="grid grid-cols-3 gap-2 max-h-[50dvh] overflow-y-auto" data-testid="mover-cuenta-mesas">
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

            {/* Mini-reproductor del pedido activo: mantiene a la vista la última
                cuenta abierta mientras el mozo se mueve por el salón, con una
                sola acción contextual (servir lo listo, enviar los borradores o
                agregar). z-30: siempre por debajo de hojas y diálogos (z-50). */}
            {miniVisible && (() => {
                const order = miniOrder;
                const trackedTable = lastOpened.table;
                const tally = accountTally(order);
                const total = order.total != null ? fmtMoney(order.total) : '—';
                const statusSummary = `${tallyLabel(tally)} · ${total}`;
                const actionVerb = tally.ready > 0 ? 'Servir' : tally.drafts > 0 ? `Enviar · ${tally.drafts}` : 'Agregar';
                const runAction = () => {
                    if (tally.ready > 0) return deliver(order.id);
                    if (tally.drafts > 0) return sendCurrentToKitchen(order.id);
                    return openTrackedSheet();
                };
                return (
                    <div
                        data-testid="salon-mini"
                        className="fixed left-3 right-3 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] z-30 mx-auto flex max-w-md items-center gap-2 rounded-sm border border-border bg-card p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)] md:bottom-0"
                    >
                        <button
                            type="button"
                            onClick={openTrackedSheet}
                            aria-label={`Pedido activo: Mesa ${trackedTable?.number}. ${statusSummary}`}
                            className="flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left transition-colors active:bg-secondary sm:min-h-9"
                        >
                            <span
                                aria-hidden="true"
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary font-display text-base font-bold"
                            >
                                {trackedTable?.number}
                            </span>
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-sm font-semibold leading-tight">
                                    {order.customer_name || `Cuenta #${order.order_number}`}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    Mesa {trackedTable?.number} · {statusSummary}
                                </span>
                            </span>
                        </button>
                        <Button size="sm" className="shrink-0" onClick={runAction} data-testid="salon-mini-accion">
                            {actionVerb}
                        </Button>
                    </div>
                );
            })()}
        </div>
    );
}
