import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '@/components/ConfirmDialog';
import NewOrderSheet from '@/components/NewOrderSheet';
import { useAuth } from '@/contexts/AuthContext';
import { PendingActionsContext } from '@/contexts/PendingActionsContext';
import useBranchNames from '@/hooks/useBranchNames';
import useRestaurantFeatures from '@/hooks/useRestaurantFeatures';
import useRequirePayment from '@/hooks/useRequirePayment';
import { ACTIONS, can, canAccessRoute } from '@/lib/permissions';
import { groupLabel, groupMembers } from '@/lib/tableGroups';
import { countOf } from '@/lib/format';
import FloorFilters from './salon/FloorFilters';
import FloorGrid from './salon/FloorGrid';
import JoinBar from './salon/JoinBar';
import MiniOrderBar from './salon/MiniOrderBar';
import MoveAccountDialog from './salon/MoveAccountDialog';
import MoveVisitDialog from './salon/MoveVisitDialog';
import PickupSections from './salon/PickupSections';
import SalonAlerts from './salon/SalonAlerts';
import SalonHeader from './salon/SalonHeader';
import SendReviewDialog from './salon/SendReviewDialog';
import TableSheet from './salon/TableSheet';
import useBranchScope from './salon/useBranchScope';
import useFloorActions from './salon/useFloorActions';
import useFloorView from './salon/useFloorView';
import useSalonData from './salon/useSalonData';
import useTableSelection from './salon/useTableSelection';
import useTableSheet from './salon/useTableSheet';
import useVisitTransfer from './salon/useVisitTransfer';
import { MINI_OPEN_CLASS, SELECT_OPEN_CLASS, isMiniVisible, selectSheetModel } from './salon/selectors';

/** Dónde se recuerda si el mozo dejó abiertos el buscador y los filtros del piso. */
const SALON_FILTERS_KEY = 'salon_filtros';

/**
 * Salón — unified floor + service screen.
 *
 * Consolidates the former Mesas (floor grid, states, priority) and Servicio
 * (inline actions, summary, visit closure, pickups) screens into one
 * touch-first operating surface for the mozo/cajero/admin.
 *
 * Two floor operations live here on top of that surface:
 *   * "Unir mesas" — a visual group of tables serving the same party, and the
 *     same gesture grows a group that is already joined. Each member keeps its
 *     own account; the group blocks the free member tables and is dissolved
 *     explicitly.
 *   * "Mover pedido" — relocates the open visit (order + visit) of a table to
 *     another free table of the same branch.
 *
 * This file is the container: it wires the hooks of `pages/salon/` (data,
 * floor view, table sheet, selection, transfer, one-shot actions) to the
 * presentational components. Rules and derivations live in
 * `pages/salon/selectors.js`.
 *
 * Kept `data-testid` contracts: `mesa-card-*`, `mesa-card-deliver-*`,
 * `mesa-card-cobrar-*`, `data-floor-state`, `mesa-sheet-*`, `servicio-cerrar-*`,
 * `servicio-recojos-activos`, `servicio-recojo-*`, `servicio-dias-anteriores`.
 */
export default function Salon() {
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const navigate = useNavigate();
    // Módulos del local (Ajustes). `item_void` apagada por defecto: el ✕ para
    // anular productos enviados solo aparece con la flag activa.
    const features = useRestaurantFeatures();
    const canVoidItems = Boolean(features.item_void);
    // Modo «solo pedidos» (Ajustes → Exigir cobro antes de liberar la mesa).
    const requirePayment = useRequirePayment();

    const [showNewOrder, setShowNewOrder] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(() => {
        try { return window.localStorage.getItem(SALON_FILTERS_KEY) === '1'; } catch { return false; }
    });

    const isOwner = can(user, ACTIONS.OWNER);

    // Alcance por sucursal del piso. El dueño ve todo el negocio, así que elige
    // qué salón mira; el resto del personal queda fijado por el servidor.
    const {
        branchCatalog, scope, scopeParams, scopeKey, scopePending, chooseScope,
    } = useBranchScope(user, isOwner);

    const {
        tables, tablesError, tablesLoading, refetchTables, orders, ordersError, refetchOrders,
        unassignedCount, products, categories, refreshAll, patchOrder,
    } = useSalonData({
        isOwner, scope, scopeKey, scopeParams, scopePending,
    });

    const canServe = can(user, ACTIONS.SALON_SERVE);
    const canTake = can(user, ACTIONS.SALON_TAKE);
    const canClose = can(user, ACTIONS.SALON_CLOSE);
    const canCharge = can(user, ACTIONS.SALON_CHARGE);

    const floorView = useFloorView({ user, tables, orders });
    const { activeOrders } = floorView;

    const sheet = useTableSheet({
        tables, orders, activeOrders, canTake, refreshAll, userId: user?.id,
    });
    const { openTable, closeSheet } = sheet;
    const selection = useTableSelection({
        tables, activeOrders, refreshAll, closeSheet,
    });
    const transfer = useVisitTransfer({
        tables, activeOrders, closeSheet, refreshAll,
    });
    const floorActions = useFloorActions({
        canTake,
        // Cobrar manda a la caja: `salon.charge` exige la función de cobro, y esa
        // función es la que abre `/caja` (ver `permissions.test.js`).
        canUseCaja: canAccessRoute(user, '/caja'),
        requirePayment,
        closeSheet, refreshAll, refetchTables, navigate, patchOrder,
    });

    const closeAreas = () => setShowNewOrder(false);

    // El botón "Nuevo pedido" abre el compositor con las pestañas de tipo.
    const openAreas = () => setShowNewOrder(true);

    // Elegir mesa en el compositor lleva al sheet de esa mesa (mismo panel).
    const pickTableForOrder = (t) => {
        closeAreas();
        void sheet.takeOrderInline(t);
    };

    const miniVisible = isMiniVisible({
        miniOrder: sheet.miniOrder,
        openTable,
        showNewOrder,
        transferSource: transfer.transferSource,
        moveAccountId: sheet.moveAccountId,
        selectMode: selection.selectMode,
    });

    // Buscar y filtrar arrancan PLEGADOS: en el teléfono empujaban la lista de mesas
    // fuera de la pantalla (título, resumen, buscador, tres botones y la fila de
    // filtros ≈ 350 px en una pantalla de 689) y el mozo tenía que desplazarse para
    // ver una sola mesa. La elección se recuerda por dispositivo: quien siempre
    // filtra los deja abiertos y no vuelve a tocar el botón.
    const toggleFilters = () => {
        setFiltersOpen((open) => {
            try { window.localStorage.setItem(SALON_FILTERS_KEY, open ? '0' : '1'); } catch { /* sin storage */ }
            return !open;
        });
    };

    const sheetModel = openTable
        ? selectSheetModel({
            openTable, sheetOrder: sheet.sheetOrder, tables, activeOrders, orders, canTake, canClose,
            requirePayment,
        })
        : null;

    return (
        <PendingActionsContext.Provider value={floorActions.pending}>
        <div
            className={`space-y-5 ${selection.selectMode ? SELECT_OPEN_CLASS : ''} ${miniVisible ? MINI_OPEN_CLASS : ''}`}
            data-testid="salon-root"
        >
            {/* La grilla vive debajo del detalle: se oculta (no se desmonta) para
                que el polling y el estado del piso sigan intactos. */}
            <div hidden={Boolean(openTable)} className="space-y-5">
                <SalonHeader
                    summary={floorView.summary}
                    floorDue={floorView.floorDue}
                    isOwner={isOwner}
                    branchCatalog={branchCatalog}
                    scope={scope}
                    chooseScope={chooseScope}
                    searchRef={floorView.searchRef}
                    search={floorView.search}
                    setSearch={floorView.setSearch}
                    navigate={navigate}
                    canTake={canTake}
                    canGoKitchen={canAccessRoute(user, '/cocina')}
                    selectMode={selection.selectMode}
                    startSelection={selection.startSelection}
                    openAreas={openAreas}
                    searchOpen={filtersOpen}
                    onToggleFilters={toggleFilters}
                    requirePayment={requirePayment}
                />

                {selection.selectMode && (
                    <JoinBar
                        selected={selection.selected}
                        pickedGroup={selection.pickedGroup}
                        tables={tables}
                        operation={selection.operation}
                        seats={selection.seats}
                        guidance={selection.guidance}
                        selectionIssue={selection.selectionIssue}
                        anchorId={selection.anchorId}
                        anchorCandidates={selection.anchorCandidates}
                        chooseAnchor={selection.chooseAnchor}
                        cancelSelection={selection.cancelSelection}
                        canConfirmJoin={selection.canConfirmJoin}
                        joining={selection.joining}
                        joinTables={selection.joinTables}
                        unpick={selection.unpick}
                    />
                )}

                {filtersOpen && (
                    <FloorFilters
                        setStateFilter={floorView.setStateFilter}
                        stateFilter={floorView.stateFilter}
                        stateCounts={floorView.stateCounts}
                        toggleSortMode={floorView.toggleSortMode}
                        sortMode={floorView.sortMode}
                        areas={floorView.areas}
                        setAreaFilter={floorView.setAreaFilter}
                        areaFilter={floorView.areaFilter}
                    />
                )}

                <SalonAlerts
                    tablesError={tablesError}
                    ordersError={ordersError}
                    refetchTables={refetchTables}
                    refetchOrders={refetchOrders}
                    isOwner={isOwner}
                    branchCatalog={branchCatalog}
                    scope={scope}
                    unassignedCount={unassignedCount}
                    navigate={navigate}
                    floorSummary={floorView.floorSummary}
                />

                <FloorGrid
                    tables={tables}
                    tablesLoading={tablesLoading}
                    scopePending={scopePending}
                    filteredUnits={floorView.filteredUnits}
                    zoneSections={floorView.zoneSections}
                    canServe={canServe}
                    canCharge={canCharge}
                    canClose={canClose}
                    canTake={canTake}
                    requirePayment={requirePayment}
                    onRelease={floorActions.releaseTable}
                    selectMode={selection.selectMode}
                    selected={selection.selected}
                    pickedGroupIds={selection.pickedGroupIds}
                    toggleSelected={selection.toggleSelected}
                    pickIssues={selection.pickIssues}
                    onSeparate={selection.askSeparateGroup}
                    separatePending={selection.separating}
                    openSheet={sheet.openSheet}
                    takeOrderInline={sheet.takeOrderInline}
                    deliver={floorActions.deliver}
                    openCharge={floorActions.openCharge}
                    closeAttention={floorActions.closeAttention}
                    requestBill={floorActions.requestBill}
                    closing={floorActions.closing}
                    branchNames={branchNames}
                />

                <PickupSections
                    pickupProjection={floorView.pickups}
                    branchNames={branchNames}
                    navigate={navigate}
                />
            </div>

            {/* Detalle de mesa: vista completa como el prototipo (reemplaza el
                Sheet lateral). En ≥820px, pedidos a la izquierda y "Resumen"
                sticky a la derecha; en móvil una columna con la barra de
                acciones fija por encima de la navegación inferior. */}
            {sheetModel && (
                <TableSheet
                    model={sheetModel}
                    sheet={sheet}
                    requirePayment={requirePayment}
                    perms={{
                        canTake, canServe, canCharge, canVoidItems,
                    }}
                    data={{
                        products, categories, branchNames, activeOrders,
                    }}
                    actions={{
                        navigate,
                        deliver: floorActions.deliver,
                        closeAttention: floorActions.closeAttention,
                        requestBill: floorActions.requestBill,
                        releaseTable: floorActions.releaseTable,
                        openCharge: floorActions.openCharge,
                        closing: floorActions.closing,
                        pending: floorActions.pending,
                        openTransfer: transfer.openTransfer,
                        dissolveGroup: selection.dissolveGroup,
                        removeGroupMember: selection.removeGroupMember,
                    }}
                />
            )}

            {/* Nuevo pedido: un solo compositor para las cuatro áreas de venta */}
            <NewOrderSheet
                open={showNewOrder}
                onOpenChange={(open) => { if (!open) closeAreas(); }}
                tables={tables}
                products={products}
                categories={categories}
                canTake={canTake}
                userId={user?.id}
                onPickTable={pickTableForOrder}
                onCreated={refreshAll}
            />

            {/* Move an open visit to another free table of the same branch */}
            <MoveVisitDialog
                transferSource={transfer.transferSource}
                setTransferSource={transfer.setTransferSource}
                transferTargets={transfer.transferTargets}
                moveVisit={transfer.moveVisit}
                movingVisit={transfer.movingVisit}
            />

            {/* Move one account to another free table */}
            <MoveAccountDialog
                moveAccountId={sheet.moveAccountId}
                setMoveAccountId={sheet.setMoveAccountId}
                tables={tables}
                openTable={openTable}
                moveAccount={sheet.moveAccount}
            />

            {/* Separar desde el piso: disolver toca a todas las mesas del grupo
                (vuelven a quedar libres u ocupadas por su cuenta), así que se
                confirma nombrando lo que se va a separar. */}
            <ConfirmDialog
                open={Boolean(selection.separateGroup)}
                title={selection.separateGroup
                    ? `¿Separar ${groupLabel(selection.separateGroup, tables)}?`
                    : ''}
                description={selection.separateGroup
                    ? `Sus ${countOf(groupMembers(selection.separateGroup, tables).length, 'mesa', 'mesas')} vuelven al piso por separado. Cada una conserva su propia cuenta y su pedido.`
                    : undefined}
                confirmLabel="Separar mesas"
                onConfirm={selection.confirmSeparateGroup}
                onCancel={selection.cancelSeparateGroup}
            />

            <SendReviewDialog
                reviewOrderId={sheet.reviewOrderId}
                sendingToKitchen={sheet.sendingToKitchen}
                setReviewOrderId={sheet.setReviewOrderId}
                reviewOrder={sheet.reviewOrder}
                reviewItems={sheet.reviewItems}
                returnToEdit={sheet.returnToEdit}
                savingItem={sheet.savingItem}
                confirmReviewedSend={sheet.confirmReviewedSend}
            />

            {/* Mini-reproductor del pedido activo: mantiene a la vista la última
                cuenta abierta mientras el mozo se mueve por el salón, con una
                sola acción contextual (servir lo listo, enviar los borradores o
                agregar). z-30: siempre por debajo de hojas y diálogos (z-50). */}
            {miniVisible && (
                <MiniOrderBar
                    miniOrder={sheet.miniOrder}
                    lastOpened={sheet.lastOpened}
                    deliver={floorActions.deliver}
                    requestSend={sheet.requestSend}
                    openTrackedSheet={sheet.openTrackedSheet}
                />
            )}
        </div>
        </PendingActionsContext.Provider>
    );
}
