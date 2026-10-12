import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function MoveVisitDialog({ transferSource, setTransferSource, transferTargets, moveVisit, movingVisit }) {
    return (
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
    );
}
