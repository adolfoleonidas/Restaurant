import { useEffect, useMemo, useRef, useState } from 'react';
import { ordersByTable } from '@/lib/tableGroups';
import {
    SORT_NUMERO,
    SORT_PRIORIDAD,
    buildUnits,
    buildZoneSections,
    countByState,
    decorateTables,
    filterUnits,
    floorSummaryText,
    indexOrdersByTable,
    listAreas,
    projectPickups,
    readSortMode,
    rememberSortMode,
    sumFloorDue,
    summarizeOrders,
} from './selectors';

/**
 * What the floor shows: the filters the waiter picks (zone, state, search,
 * order) and everything derived from the tables and the live orders.
 */
export default function useFloorView({ user, tables, orders }) {
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('todas');
    const [stateFilter, setStateFilter] = useState('todas');
    const [sortMode, setSortMode] = useState(() => readSortMode(user?.id));
    const searchRef = useRef(null);

    const byTable = useMemo(() => indexOrdersByTable(orders), [orders]);

    // Only the orders that still own their table: these decide what a joined
    // table can offer (join, transfer) and which member holds the account.
    const activeOrders = useMemo(() => ordersByTable(orders), [orders]);

    // ── Summary (former Servicio header) ───────────────────────────────────
    const pickups = useMemo(() => projectPickups(orders), [orders]);

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
    // Cabecera y chips cuentan lo mismo: platos en cocina/listos, y mesas por cobrar.
    const summary = useMemo(
        () => ({ ...summarizeOrders(orders), toPay: stateCounts.cuenta }),
        [orders, stateCounts]
    );
    const floorSummary = floorSummaryText(summary);
    const filteredUnits = useMemo(
        () => filterUnits(units, { areaFilter, stateFilter, search, sortMode }),
        [units, areaFilter, stateFilter, search, sortMode]
    );
    const floorDue = useMemo(() => sumFloorDue(units), [units]);
    const zoneSections = useMemo(
        () => buildZoneSections(filteredUnits, areas, areaFilter),
        [filteredUnits, areas, areaFilter]
    );

    const toggleSortMode = () => {
        const next = sortMode === SORT_PRIORIDAD ? SORT_NUMERO : SORT_PRIORIDAD;
        setSortMode(next);
        rememberSortMode(user?.id, next);
    };

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

    return {
        search,
        setSearch,
        areaFilter,
        setAreaFilter,
        stateFilter,
        setStateFilter,
        sortMode,
        toggleSortMode,
        searchRef,
        byTable,
        activeOrders,
        summary,
        floorSummary,
        pickups,
        areas,
        units,
        stateCounts,
        filteredUnits,
        floorDue,
        zoneSections,
    };
}
