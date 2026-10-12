import React from 'react';
import { Button } from '@/components/ui/button';

export default function SalonAlerts({ tablesError, ordersError, refetchTables, refetchOrders, isOwner, branchCatalog, scope, unassignedCount, navigate, floorSummary }) {
    return (
        <>
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
        </>
    );
}
