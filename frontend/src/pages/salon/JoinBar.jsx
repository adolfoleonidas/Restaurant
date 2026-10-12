import React from 'react';
import { Button } from '@/components/ui/button';
import { Link2 } from 'lucide-react';

/**
 * Bottom action bar of the "unir mesas" mode (thumb friendly). On mobile it sits above the bottom navigation: both are z-40.
 */
export default function JoinBar({
    canConfirmJoin, cancelSelection, joinTables, joining,
    selected, selectionIssue, tables,
}) {
    return (
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
    );
}
