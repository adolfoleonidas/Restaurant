import React from 'react';
import { Plus } from 'lucide-react';
import { AccountTotals } from '@/components/OrderSummary';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';

export default function SheetSummaryPanel({ cards, personAccounts, tableConsumido, tablePagado, tablePendiente, hasAccount, billRequested, closeable, canCompose, savingItem, sendingToKitchen, loading, startNewAccount, composerOpen, canCharge, actionDue, accountTable, order, openCharge, actionOrder }) {
    return (
        <aside
            data-testid="mesa-sheet-resumen-panel"
            className="grid content-start gap-3 min-[820px]:sticky min-[820px]:top-4"
        >
            <h3 className="font-display text-base font-semibold">Resumen</h3>
            <div className="flex justify-between gap-2.5 text-sm">
                <span className="text-muted-foreground">Pedidos</span>
                <strong data-testid="mesa-sheet-pedidos-count">{cards.length}</strong>
            </div>
            {/* Consumido/Pagado/Pendiente como el mockup; el
                desglose por producto y el recibo viven en el
                diálogo "Resumen de mesa" de ⋯ Más. */}
            {personAccounts.length > 0 && (
                <AccountTotals
                    testIdPrefix="mesa-sheet"
                    consumido={tableConsumido}
                    pagado={tablePagado}
                    pendiente={tablePendiente}
                />
            )}
            {/* El estado "cuenta solicitada" es información,
                no una tercera acción: vive como aviso en el
                resumen y la barra queda con sus dos botones. */}
            {hasAccount && billRequested && !closeable && (
                <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    data-testid="mesa-sheet-cuenta-solicitada"
                    className="w-full h-12 rounded-xl border border-dashed text-sm font-semibold text-muted-foreground"
                >
                    Cuenta solicitada
                </button>
            )}
            {/* Una sola instancia de cada botón: en móvil esta
                barra se fija abajo; en escritorio vive en el
                resumen. Así no se duplican testids. */}
            <div
                data-testid="mesa-sheet-acciones"
                className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] z-30 space-y-2 border-t bg-card/95 p-3 backdrop-blur min-[820px]:static min-[820px]:inset-auto min-[820px]:z-auto min-[820px]:rounded-xl min-[820px]:border min-[820px]:p-3 min-[820px]:backdrop-blur-none"
            >
        {/* S13: exactamente dos botones. Entregar,
            finalizar/solicitar cuenta y liberar viven
            ahora en el menú ⋯ de la cabecera. */}
        {canCompose && (
            <Button
                variant="outline"
                className="w-full h-12"
                disabled={savingItem || sendingToKitchen || loading}
                onClick={startNewAccount}
                aria-expanded={composerOpen}
                data-testid="mesa-sheet-nuevo-pedido"
            >
                <Plus className="h-4 w-4 mr-1" /> + Nuevo pedido
            </Button>
        )}
        {canCharge && actionDue > 0 && ((accountTable && order) || hasAccount) && (
            <Button
                className="w-full h-12 bg-[hsl(var(--warn))] text-[hsl(var(--background))] hover:opacity-90"
                onClick={() => openCharge(actionOrder)}
                data-testid="mesa-sheet-cobrar"
            >
                Cobrar {fmtMoney(actionDue)}
            </Button>
        )}
            </div>
        </aside>
    );
}
