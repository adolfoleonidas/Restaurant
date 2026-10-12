import React from 'react';
import { PersonOrderSummary } from '@/components/OrderSummary';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fmtMoney } from '@/lib/format';
import { itemsTotal, personLabel } from '@/lib/orderDraft';

export default function SendReviewDialog({ reviewOrderId, sendingToKitchen, setReviewOrderId, reviewOrder, reviewItems, returnToEdit, savingItem, confirmReviewedSend }) {
    return (
        <Dialog
            open={Boolean(reviewOrderId)}
            onOpenChange={(open) => {
                if (!open && !sendingToKitchen) setReviewOrderId(null);
            }}
        >
            <DialogContent data-testid="mesa-sheet-revision-envio" aria-describedby="mesa-sheet-revision-descripcion">
                <DialogHeader>
                    <DialogTitle>Revisar pedido para cocina</DialogTitle>
                    <DialogDescription id="mesa-sheet-revision-descripcion" data-testid="mesa-sheet-revision-descripcion">
                        Revisa los borradores y sus cantidades antes de confirmar el envío a cocina.
                    </DialogDescription>
                </DialogHeader>
                {reviewOrder && (
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground" data-testid="mesa-sheet-aviso-edicion">
                            Después de confirmar, los productos enviados no se pueden editar.
                        </p>
                        <p className="text-sm font-medium" data-testid="mesa-sheet-revision-persona">
                            {reviewOrder.customer_name || personLabel(reviewOrder)}
                        </p>
                        <PersonOrderSummary
                            testIdPrefix="mesa-sheet-revision"
                            items={reviewItems}
                            orderStatus={reviewOrder.status}
                            mode="detail"
                        />
                        <div className="flex items-center justify-between border-t pt-3 font-semibold">
                            <span>Este pedido</span>
                            <span className="font-mono tabular-nums">{fmtMoney(itemsTotal(reviewItems))}</span>
                        </div>
                    </div>
                )}
                {reviewOrder && !reviewItems.length && (
                    <p role="status" className="text-sm text-muted-foreground" data-testid="mesa-sheet-revision-vacia">
                        No hay borradores para enviar. Puede que se hayan enviado o actualizado desde que abriste esta revisión. Actualiza el pedido antes de confirmar.
                    </p>
                )}
                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={sendingToKitchen}
                        onClick={returnToEdit}
                        data-testid="mesa-sheet-volver-editar"
                    >
                        Volver a editar
                    </Button>
                    <Button
                        type="button"
                        disabled={!reviewItems.length || savingItem || sendingToKitchen}
                        onClick={confirmReviewedSend}
                        data-testid="mesa-sheet-confirmar-envio"
                    >
                        {sendingToKitchen ? 'Enviando…' : 'Confirmar envío'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
