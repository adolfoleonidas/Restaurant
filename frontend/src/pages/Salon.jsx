import React, { useEffect, useMemo, useRef, useState } from 'react';
import useBranchScope from '@/pages/salon/useBranchScope';
import useSalonData from '@/pages/salon/useSalonData';
import useTableSheet from '@/pages/salon/useTableSheet';
import useTableSelection from '@/pages/salon/useTableSelection';
import useVisitTransfer from '@/pages/salon/useVisitTransfer';
import useFloorActions from '@/pages/salon/useFloorActions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { fmtMoney, fmtElapsed, fmtDateTime } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import {
    LEGEND,
    MINI_OPEN_CLASS,
    STATE_FILTERS,
    accountTally,
    buildUnits,
    countByState,
    decorateTables,
    filterUnits,
    floorSummaryText,
    freeTablesForAccountMove,
    indexOrdersByTable,
    isComposingDraft,
    isMiniVisible,
    listAreas,
    projectPickups,
    selectMiniOrder,
    selectSheetModel,
    summarizeOrders,
    tallyLabel,
} from '@/pages/salon/selectors';
import OrderComposer from '@/components/OrderComposer';
import PersonChips from '@/components/PersonChips';
import { PersonOrderSummary, TableReceipt, TableSummary } from '@/components/OrderSummary';
import NewOrderSheet from '@/components/NewOrderSheet';
import { Search, Grid2X2, Plus, Users, ShoppingCart, Link2, Unlink, MoveRight } from 'lucide-react';
import MoreActions from '@/components/MoreActions';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { hasFn } from '@/lib/functions';
import AttentionReference from '@/components/AttentionReference';
import MesaCard from '@/components/MesaCard';
import GroupCard from '@/components/GroupCard';
import useBranchNames from '@/hooks/useBranchNames';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import { ordersByTable } from '@/lib/tableGroups';

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

export default function Salon() {
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const navigate = useNavigate();
    const { generation } = useNotify();

    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [stateFilter, setStateFilter] = useState('todas');
    const [showNewOrder, setShowNewOrder] = useState(false);
    const searchRef = useRef(null);

    const isOwner = user?.role === 'admin' || hasFn(user, 'administracion');
    const canServe = ['admin', 'mozo', 'cocina'].includes(user?.role);
    const canTake = ['admin', 'mozo'].includes(user?.role);
    const canClose = ['admin', 'mozo', 'cajero'].includes(user?.role);
    const canCharge = hasFn(user, 'cobro', 'administracion');

    // Alcance por sucursal del piso. El dueño ve todo el negocio, así que elige
    // qué salón mira; el resto del personal queda fijado por el servidor.
    const {
        branchCatalog, scope, scopeParams, scopeKey, scopePending, chooseScope,
    } = useBranchScope(user, isOwner);

    const {
        tables, tablesError, tablesLoading, refetchTables, orders, ordersError, refetchOrders,
        unassignedCount, products, categories, refreshAll,
    } = useSalonData({
        generation, isOwner, scope, scopeKey, scopeParams, scopePending,
    });

    const byTable = useMemo(() => indexOrdersByTable(orders), [orders]);

    // Only the orders that still own their table: these decide what a joined
    // table can offer (join, transfer) and which member holds the account.
    const activeOrders = useMemo(() => ordersByTable(orders), [orders]);

    const {
        openTable, sheetOrder, savingItem, aliasDraft, setAliasDraft, flash, setFlash, sharedDraft, setSharedDraft,
        receiptOpen, setReceiptOpen, composerOpen, setComposerOpen, moveAccountId, setMoveAccountId, lastOpened,
        openSheet, closeSheet, selectAccount, mergeAccounts, moveAccount, splitAccount, addProductToAccount,
        changeItemQty, removeProductFromAccount, saveItemNotes, voidProduct, applyItemNote, moveItemToPerson,
        sendCurrentToKitchen, saveAlias, startAnotherPerson, takeOrderInline, openTrackedSheet,
    } = useTableSheet({
        tables, activeOrders, canTake, refreshAll,
    });

    const {
        selectMode, selected, joining, selectionIssue, canConfirmJoin, toggleSelected, startSelection,
        cancelSelection, joinTables, dissolveGroup, removeGroupMember,
    } = useTableSelection({
        tables, activeOrders, refreshAll, closeSheet,
    });

    const {
        transferSource, setTransferSource, movingVisit, transferTargets, openTransfer, moveVisit,
    } = useVisitTransfer({
        tables, activeOrders, closeSheet, refreshAll,
    });

    const {
        closing, openCharge, deliver, closeAttention, requestBill, releaseTable,
    } = useFloorActions({
        canTake, closeSheet, refreshAll, refetchTables, navigate,
    });

    // ── Summary (former Servicio header) ───────────────────────────────────
    const summary = useMemo(() => summarizeOrders(orders), [orders]);
    const floorSummary = floorSummaryText(summary);
    const pickupProjection = useMemo(() => projectPickups(orders), [orders]);

    // ── Filters ────────────────────────────────────────────────────────────
    const areas = useMemo(() => listAreas(tables), [tables]);
    const decorated = useMemo(
        () => decorateTables({ tables, byTable, orders, activeOrders }),
        [tables, byTable, orders, activeOrders]
    );
    const units = useMemo(
        () => buildUnits({ decorated, tables, activeOrders }),
        [decorated, tables, activeOrders]
    );
    const stateCounts = useMemo(() => countByState(units), [units]);
    const filteredUnits = useMemo(
        () => filterUnits(units, { areaFilter, stateFilter, search }),
        [units, areaFilter, stateFilter, search]
    );

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

    const miniOrder = useMemo(() => selectMiniOrder(orders, lastOpened), [orders, lastOpened]);

    const miniVisible = isMiniVisible({
        miniOrder, openTable, showNewOrder, transferSource, moveAccountId, selectMode,
    });

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
                        const {
                            table: t, history, loading, accountTable, accounts, group, members, groupAccounts, order,
                            currentAccountId, floor, canCompose, allItems, orderItems, sendState, showSend, personAccounts,
                            persons, summaryRows, receiptAccounts, tableDishes, tableTotal, pendingCount, hasAccount,
                            actionOrder, actionAccountId, closeable, billRequested,
                        } = selectSheetModel({ openTable, sheetOrder, tables, activeOrders, canTake, canClose });
                        const s = FLOOR_STYLE[floor.key];
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
                                {/* "+ Pedido" arriba, donde el mozo ya está mirando: abre la
                                    carta. La acción principal de cada momento (Enviar,
                                    Entregar, Cuenta) vive abajo, en el pulgar. */}
                                {canCompose && (
                                    <div className="flex items-center justify-end gap-2 border-b px-5 py-2">
                                        <Button
                                            variant={composerOpen ? 'outline' : 'default'}
                                            className="h-11"
                                            onClick={() => setComposerOpen((open) => !open)}
                                            aria-expanded={composerOpen}
                                            data-testid="mesa-sheet-nuevo-pedido"
                                        >
                                            {composerOpen ? 'Ocultar carta' : '+ Pedido'}
                                        </Button>
                                    </div>
                                )}
                                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                    {t.active_order && loading && <div className="text-sm text-muted-foreground">Cargando pedido…</div>}
                                    {/* El resumen va arriba y plegado: el mozo lo lee de
                                        reojo sin que le empuje la carta hacia abajo. */}
                                    {/* El resumen sólo aparece cuando hay más de una cuenta:
                                        ahí es donde sirve (organizar personas y ver el recibo).
                                        Con una sola repetiría lo que ya dicen la lista y el pie,
                                        y el modal tiene que ser simple. */}
                                    {personAccounts.length > 1 && (
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
                                    )}
                                    {receiptOpen && (
                                        <TableReceipt
                                            table={t}
                                            rows={summaryRows}
                                            accounts={receiptAccounts}
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
                                    {/* La carta se queda montada al plegarse: así conserva
                                        la búsqueda y la categoría elegidas cuando el mozo
                                        la vuelve a abrir para el pedido siguiente. */}
                                    <div hidden={!composerOpen}>
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
                                    </div>
                                    {order && (
                                        <>
                                            <div className="text-sm text-muted-foreground space-y-1">
                                                <div>Pedido #{order.order_number} · {order.source === 'public' ? 'Carta web' : 'Salón'}</div>
                                                <AttentionReference order={order} branchNames={branchNames} />
                                                {order.customer_name && <div>Cliente: <span className="text-foreground">{order.customer_name}</span></div>}
                                                <div>Hace {fmtElapsed(order.created_at)} · {ORDER_STATUS_LABELS[order.status] || order.status}</div>
                                            </div>
                                            <p className="text-xs font-medium text-muted-foreground" data-testid="mesa-sheet-items-titulo">
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
                                            <div className="text-xs font-medium text-muted-foreground">Mesas unidas</div>
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
                                            <div className="text-xs font-medium text-muted-foreground">Turnos anteriores</div>
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
                                    {/* La mesa no se "toma": la atención nace con el primer
                                        pedido, así que la carta es la acción y no hay botón
                                        que la reemplace. Los botones de tomar mesa que había
                                        acá sólo repetían esa acción y parecían recargar. */}
                                    {accountTable && order ? (
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
                                    ) : hasAccount ? (
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
                                    ) : t.status === 'pagada' ? (
                                        <Button className="w-full h-12" variant="outline" onClick={() => releaseTable(t)} disabled={!canTake} data-testid="mesa-sheet-liberar">
                                            Liberar mesa
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
                            const targets = freeTablesForAccountMove(tables, openTable?.table?.id);
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
