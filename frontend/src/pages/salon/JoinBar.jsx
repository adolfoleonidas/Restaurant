import React from 'react';
import { Link2, Plus, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { countOf } from '@/lib/format';
import { groupLabel } from '@/lib/tableGroups';

/**
 * JoinBar — the bar that guides "unir mesas", pinned to the thumb zone.
 *
 * It answers, in this order, the three things the mozo asks while picking:
 *
 *  1. *what did I pick?* — the chips, each one removable by tapping it, so a
 *     wrong tap is undone where it was made instead of cancelling everything;
 *  2. *what is this for?* — one guidance line that never disappears (it used to
 *     be replaced by the chosen numbers exactly when one more table was still
 *     missing), replaced by the reason when the picks cannot be joined;
 *  3. *how do I confirm?* — one button that names the operation and its size.
 *
 * `salon-seleccion-resumen` keeps carrying the chosen numbers, so the bar reads
 * the same to a screen reader as it did before the chips existed.
 */

function Chip({ label, title, onRemove, testId }) {
    return (
        <button
            type="button"
            onClick={onRemove}
            title={title}
            data-testid={testId}
            className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-sm font-semibold touch-target-coarse active:bg-black/5"
        >
            <span className="truncate">{label}</span>
            <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
    );
}

export default function JoinBar({
    selected, pickedGroup, tables, operation, seats, guidance, selectionIssue,
    anchorId, anchorCandidates, chooseAnchor, cancelSelection, canConfirmJoin,
    joining, joinTables, unpick,
}) {
    const extending = operation?.kind === 'extend' && Boolean(pickedGroup);
    // Las mesas elegidas, en el orden del piso: la barra no rebaraja lo que el
    // mozo acaba de tocar.
    const pickedTables = (tables || [])
        .filter((t) => selected.includes(t.id))
        .sort((a, b) => Number(a.number) - Number(b.number));
    const nothingPicked = pickedTables.length === 0 && !pickedGroup;
    // El botón dice el tamaño de lo que va a hacer: "Unir 2 mesas" no se lee
    // igual que "Unir 4 mesas" cuando la fiesta acaba de llegar.
    const confirmLabel = extending
        ? (pickedTables.length ? `Sumar ${countOf(pickedTables.length, 'mesa', 'mesas')}` : 'Sumar mesas')
        : (pickedTables.length >= 2 ? `Unir ${countOf(pickedTables.length, 'mesa', 'mesas')}` : 'Unir mesas');

    return (
        // En móvil sube por encima de la barra de navegación inferior: las dos
        // están en z-40.
        <div
            className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] z-40 border-t bg-card px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.10)] md:bottom-0"
            data-testid="salon-seleccion"
        >
            <div className="mx-auto flex max-w-6xl flex-col gap-2">
                {/* 1. Lo elegido, quitable de uno en uno. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm text-muted-foreground">Elegidas:</span>
                    <span className="flex flex-wrap items-center gap-1 text-sm font-medium" data-testid="salon-seleccion-resumen">
                        {nothingPicked && <span className="text-muted-foreground">ninguna todavía</span>}
                        {pickedGroup && (
                            <>
                                <Chip
                                    label={groupLabel(pickedGroup, tables)}
                                    title={`Quitar ${groupLabel(pickedGroup, tables)} de la selección`}
                                    onRemove={() => unpick(pickedGroup.id)}
                                    testId="salon-seleccion-quitar-grupo"
                                />
                                {pickedTables.length > 0 && <span aria-hidden="true">{' + '}</span>}
                            </>
                        )}
                        {pickedTables.map((table, index) => (
                            <React.Fragment key={table.id}>
                                {index > 0 && <span aria-hidden="true">{' + '}</span>}
                                <Chip
                                    label={table.number}
                                    title={`Quitar Mesa ${table.number} de la selección`}
                                    onRemove={() => unpick(table.id)}
                                    testId={`salon-seleccion-quitar-${table.number}`}
                                />
                            </React.Fragment>
                        ))}
                    </span>
                    {/* La suma de asientos es lo que el mozo comprueba contra la
                        fiesta que tiene delante; sin capacidades no se inventa. */}
                    {seats != null && !nothingPicked && (
                        <span className="text-sm text-muted-foreground" data-testid="salon-seleccion-asientos">
                            {countOf(seats, 'asiento', 'asientos')}
                        </span>
                    )}
                </div>

                {/* 2. Para qué es, o por qué no se puede. */}
                <p className={selectionIssue ? 'sr-only' : 'text-sm text-muted-foreground'} data-testid="salon-seleccion-paso">
                    {guidance}
                </p>
                {selectionIssue && (
                    <p className="text-xs font-medium text-destructive" data-testid="salon-seleccion-aviso">
                        {selectionIssue}
                    </p>
                )}

                {/* 3. La mesa principal (solo al formar grupo) y las acciones. */}
                <div className="flex flex-wrap items-center gap-2">
                    {anchorCandidates.length > 1 && (
                        <div className="flex items-center gap-1" data-testid="salon-seleccion-principal">
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Star className="h-3.5 w-3.5" aria-hidden="true" /> Principal
                            </span>
                            {anchorCandidates.map((table) => (
                                <button
                                    key={table.id}
                                    type="button"
                                    aria-pressed={table.id === anchorId}
                                    data-testid={`salon-seleccion-principal-${table.number}`}
                                    onClick={() => chooseAnchor(table.id)}
                                    className={`min-h-9 min-w-9 touch-target-coarse rounded-md border px-2 text-sm font-semibold active:bg-black/5 ${table.id === anchorId ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}
                                >
                                    {table.number}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="ml-auto flex gap-2">
                        <Button variant="outline" onClick={cancelSelection} data-testid="salon-seleccion-cancelar">
                            Cancelar
                        </Button>
                        <Button disabled={!canConfirmJoin || joining} onClick={joinTables} data-testid="salon-unir-confirmar">
                            {extending ? <Plus className="h-4 w-4 mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
                            {joining ? 'Uniendo…' : confirmLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
