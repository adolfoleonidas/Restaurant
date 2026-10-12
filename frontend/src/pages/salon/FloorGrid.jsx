import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import MesaCard from '@/components/MesaCard';
import GroupCard from '@/components/GroupCard';

/**
 * The floor: skeleton while loading, an empty message, or one card per unit.
 */
export default function FloorGrid({
    branchNames, canCharge, canClose, canServe,
    canTake, closeAttention, closing, deliver,
    filteredUnits, openCharge, openSheet, scopePending,
    selectMode, selected, tables, tablesLoading,
    takeOrderInline, toggleSelected,
}) {
    return (
        <>
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
        </>
    );
}
