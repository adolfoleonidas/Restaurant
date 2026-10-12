import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { freeTablesForAccountMove } from '@/pages/salon/selectors';

/**
 * Dialog that moves one account of the open table to a free table.
 */
export default function MoveAccountDialog({
    moveAccount, moveAccountId, openTable, setMoveAccountId,
    tables,
}) {
    return (
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
    );
}
