import React, { useEffect, useMemo, useRef, useState } from 'react';
import useBranchScope from '@/pages/salon/useBranchScope';
import useSalonData from '@/pages/salon/useSalonData';
import useTableSheet from '@/pages/salon/useTableSheet';
import useTableSelection from '@/pages/salon/useTableSelection';
import useVisitTransfer from '@/pages/salon/useVisitTransfer';
import useFloorActions from '@/pages/salon/useFloorActions';
import SalonHeader from '@/pages/salon/SalonHeader';
import JoinBar from '@/pages/salon/JoinBar';
import FloorFilters from '@/pages/salon/FloorFilters';
import SalonAlerts from '@/pages/salon/SalonAlerts';
import FloorGrid from '@/pages/salon/FloorGrid';
import PickupSections from '@/pages/salon/PickupSections';
import MoveVisitDialog from '@/pages/salon/MoveVisitDialog';
import MoveAccountDialog from '@/pages/salon/MoveAccountDialog';
import TableSheet from '@/pages/salon/TableSheet';
import MiniOrderBar from '@/pages/salon/MiniOrderBar';
import { useNavigate } from 'react-router-dom';
import {
    MINI_OPEN_CLASS,
    buildUnits,
    countByState,
    decorateTables,
    filterUnits,
    floorSummaryText,
    indexOrdersByTable,
    isMiniVisible,
    listAreas,
    projectPickups,
    selectMiniOrder,
    summarizeOrders,
} from '@/pages/salon/selectors';
import NewOrderSheet from '@/components/NewOrderSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { ACTIONS, can } from '@/lib/permissions';
import useBranchNames from '@/hooks/useBranchNames';
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

    const isOwner = can(user, ACTIONS.OWNER);
    const canServe = can(user, ACTIONS.SALON_SERVE);
    const canTake = can(user, ACTIONS.SALON_TAKE);
    const canClose = can(user, ACTIONS.SALON_CLOSE);
    const canCharge = can(user, ACTIONS.SALON_CHARGE);

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
            <SalonHeader
                branchCatalog={branchCatalog}
                canTake={canTake}
                chooseScope={chooseScope}
                isOwner={isOwner}
                navigate={navigate}
                openAreas={openAreas}
                scope={scope}
                search={search}
                searchRef={searchRef}
                selectMode={selectMode}
                setSearch={setSearch}
                startSelection={startSelection}
                summary={summary}
            />

            {/* Join mode: bottom action bar (thumb-friendly). En móvil sube por
                encima de la barra de navegación inferior: las dos están en z-40. */}
            {selectMode && (
                <JoinBar
                    canConfirmJoin={canConfirmJoin}
                    cancelSelection={cancelSelection}
                    joinTables={joinTables}
                    joining={joining}
                    selected={selected}
                    selectionIssue={selectionIssue}
                    tables={tables}
                />
            )}

            <FloorFilters
                areaFilter={areaFilter}
                areaLabel={areaLabel}
                areas={areas}
                setAreaFilter={setAreaFilter}
                setStateFilter={setStateFilter}
                stateCounts={stateCounts}
                stateFilter={stateFilter}
            />

            <SalonAlerts
                branchCatalog={branchCatalog}
                isOwner={isOwner}
                navigate={navigate}
                ordersError={ordersError}
                refetchOrders={refetchOrders}
                refetchTables={refetchTables}
                scope={scope}
                tablesError={tablesError}
                unassignedCount={unassignedCount}
            />

            <div role="status" aria-live="polite" className="sr-only">{floorSummary}</div>

            <FloorGrid
                branchNames={branchNames}
                canCharge={canCharge}
                canClose={canClose}
                canServe={canServe}
                canTake={canTake}
                closeAttention={closeAttention}
                closing={closing}
                deliver={deliver}
                filteredUnits={filteredUnits}
                openCharge={openCharge}
                openSheet={openSheet}
                scopePending={scopePending}
                selectMode={selectMode}
                selected={selected}
                tables={tables}
                tablesLoading={tablesLoading}
                takeOrderInline={takeOrderInline}
                toggleSelected={toggleSelected}
            />

            <PickupSections
                branchNames={branchNames}
                navigate={navigate}
                pickupProjection={pickupProjection}
            />

            {/* Table detail sheet (secondary actions) */}
            <TableSheet
                activeOrders={activeOrders}
                addProductToAccount={addProductToAccount}
                aliasDraft={aliasDraft}
                applyItemNote={applyItemNote}
                branchNames={branchNames}
                canClose={canClose}
                canServe={canServe}
                canTake={canTake}
                categories={categories}
                changeItemQty={changeItemQty}
                closeAttention={closeAttention}
                closeSheet={closeSheet}
                closing={closing}
                composerOpen={composerOpen}
                deliver={deliver}
                dissolveGroup={dissolveGroup}
                flash={flash}
                mergeAccounts={mergeAccounts}
                moveItemToPerson={moveItemToPerson}
                navigate={navigate}
                openTable={openTable}
                openTransfer={openTransfer}
                products={products}
                receiptOpen={receiptOpen}
                releaseTable={releaseTable}
                removeGroupMember={removeGroupMember}
                removeProductFromAccount={removeProductFromAccount}
                requestBill={requestBill}
                saveAlias={saveAlias}
                saveItemNotes={saveItemNotes}
                savingItem={savingItem}
                selectAccount={selectAccount}
                sendCurrentToKitchen={sendCurrentToKitchen}
                setAliasDraft={setAliasDraft}
                setComposerOpen={setComposerOpen}
                setFlash={setFlash}
                setMoveAccountId={setMoveAccountId}
                setReceiptOpen={setReceiptOpen}
                setSharedDraft={setSharedDraft}
                sharedDraft={sharedDraft}
                sheetOrder={sheetOrder}
                splitAccount={splitAccount}
                startAnotherPerson={startAnotherPerson}
                tables={tables}
                takeOrderInline={takeOrderInline}
                voidProduct={voidProduct}
            />

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
            <MoveVisitDialog
                moveVisit={moveVisit}
                movingVisit={movingVisit}
                setTransferSource={setTransferSource}
                transferSource={transferSource}
                transferTargets={transferTargets}
            />

            {/* Move one account to another free table */}
            <MoveAccountDialog
                moveAccount={moveAccount}
                moveAccountId={moveAccountId}
                openTable={openTable}
                setMoveAccountId={setMoveAccountId}
                tables={tables}
            />

            {/* Mini-reproductor del pedido activo: mantiene a la vista la última
                cuenta abierta mientras el mozo se mueve por el salón, con una
                sola acción contextual (servir lo listo, enviar los borradores o
                agregar). z-30: siempre por debajo de hojas y diálogos (z-50). */}
            {miniVisible && (
                <MiniOrderBar
                    order={miniOrder}
                    trackedTable={lastOpened.table}
                    onDeliver={deliver}
                    onSend={sendCurrentToKitchen}
                    onOpen={openTrackedSheet}
                />
            )}
        </div>
    );
}
