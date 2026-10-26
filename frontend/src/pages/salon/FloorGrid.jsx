import React from 'react';
import GroupCard from '@/components/GroupCard';
import MesaCard from '@/components/MesaCard';
import { Skeleton } from '@/components/ui/skeleton';

export default function FloorGrid({
    tables, tablesLoading, scopePending, filteredUnits, zoneSections, canServe, canCharge,
    canClose, canTake, closing, selectMode, selected, pickedGroupIds, toggleSelected,
    pickIssues, onSeparate, separatePending, openSheet, deliver, openCharge, closeAttention,
    requestBill, takeOrderInline, branchNames, requirePayment = true, onRelease,
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
                // El piso se lee por zonas, como el salón real: una sección por
                // zona con mesas visibles después de búsqueda y filtros.
                <div className="space-y-5" data-testid="salon-piso">
                    {zoneSections.map(({ area, units: zoneUnits }) => (
                        <section key={area} aria-label={area} data-testid={`salon-zona-${area}`}>
                            <div className="mb-2 flex items-baseline justify-between gap-2">
                                <h2 className="font-display text-lg font-semibold">{area}</h2>
                                <span className="text-sm text-muted-foreground">
                                    {zoneUnits.length} {zoneUnits.length === 1 ? 'mesa' : 'mesas'}
                                </span>
                            </div>
                            <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                                {/* The card shortcut for taking an order opens the same sales-area
                                    decision as the sheet, so no table is seated before the waiter
                                    picks mesa / llevar / recojo / delivery. */}
                                {zoneUnits.map((unit) => (
                                    unit.type === 'group' ? (
                                        <GroupCard
                                            key={unit.group.id}
                                            unit={unit}
                                            canServe={canServe}
                                            canCharge={canCharge}
                                            canSeparate={canTake}
                                            selectMode={selectMode}
                                            picked={pickedGroupIds.includes(unit.group.id)}
                                            pickIssue={pickIssues[unit.anchor.table.id] || null}
                                            separating={separatePending === unit.group.id}
                                            onSelect={toggleSelected}
                                            onSeparate={() => onSeparate(unit.group)}
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
                                            requirePayment={requirePayment}
                                            closing={closing}
                                            selectMode={selectMode}
                                            picked={selected.includes(unit.entry.table.id)}
                                            pickIssue={pickIssues[unit.entry.table.id] || null}
                                            onSelect={toggleSelected}
                                            onOpen={openSheet}
                                            onDeliver={deliver}
                                            onCharge={openCharge}
                                            onCloseAttention={closeAttention}
                                            onRequestBill={requestBill}
                                            onTake={takeOrderInline}
                                            onRelease={onRelease}
                                        />
                                    )
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </>
    );
}
