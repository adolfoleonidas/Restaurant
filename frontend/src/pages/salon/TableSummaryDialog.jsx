import React from 'react';
import { TableReceipt, TableSummary } from '@/components/OrderSummary';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function TableSummaryDialog({ summaryOpen, setSummaryOpen, setReceiptOpen, summaryRows, personAccounts, tableDishes, tableTotal, persons, canCompose, moveItemToPerson, receiptOpen, t, receiptAccounts, pendingCount }) {
    return (
        <Dialog open={summaryOpen} onOpenChange={(open) => { setSummaryOpen(open); if (!open) setReceiptOpen(false); }}>
            <DialogContent className="sm:max-w-lg" data-testid="mesa-sheet-resumen-dialog">
                <DialogHeader>
                    <DialogTitle className="font-display text-2xl">Resumen de mesa</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1" data-testid="mesa-sheet-resumen-contenido">
                    <TableSummary
                        rows={summaryRows}
                        accounts={personAccounts.length}
                        dishes={tableDishes}
                        total={tableTotal}
                        people={persons}
                        canEdit={canCompose && persons.length > 1}
                        showTotals={false}
                        onMoveItem={moveItemToPerson}
                        onOpenReceipt={() => setReceiptOpen(true)}
                    />
                    {receiptOpen && (
                        <TableReceipt
                            table={t}
                            rows={summaryRows}
                            accounts={receiptAccounts}
                            total={tableTotal}
                            pending={pendingCount}
                        />
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setSummaryOpen(false)} data-testid="mesa-sheet-resumen-cerrar">
                        Cerrar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
