import React from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Link2, MoveRight } from 'lucide-react';
import MoreActions from '@/components/MoreActions';

/**
 * Main and secondary actions at the bottom of the table sheet.
 */
export default function TableSheetFooter({
    accountTable, accounts, actionAccountId, actionOrder,
    billRequested, canServe, canTake, closeAttention,
    closeSheet, closeable, closing, deliver,
    floor, group, hasAccount, mergeAccounts,
    navigate, openTransfer, order, releaseTable,
    requestBill, setMoveAccountId, splitAccount, t,
    takeOrderInline,
}) {
    return (
        <div className="border-t p-4 space-y-2">
            {/* La mesa no se "toma": la atención nace con el primer
                pedido, así que la carta es la acción y no hay botón
                que la reemplace. Los botones de tomar mesa que había
                acá sólo repetían esa acción y parecían recargar. */}
            {accountTable && order ? (
                <>
                    {canTake && (
                        <Button
                            className="w-full h-12"
                            onClick={() => takeOrderInline(t)}
                            data-testid="mesa-sheet-pedir-grupo"
                        >
                            <Plus className="h-4 w-4 mr-1" /> Pedir para Mesa {t.number} (cuenta aparte)
                        </Button>
                    )}
                    <MoreActions
                        testId="mesa-sheet-mas-grupo"
                        actions={[{
                            key: 'ver-pedido-grupo',
                            label: `Ver pedido de Mesa ${accountTable.number}`,
                            testId: 'mesa-sheet-ver-pedido-grupo',
                            onSelect: () => { closeSheet(); navigate(`/pedidos/${order.id}`); },
                        }]}
                    />
                </>
            ) : hasAccount ? (
                <>
                    {/* La barra tiene un lugar por tipo de acción:
                        operar (Entregar), cerrar (Cuenta) y el resto
                        en ⋯ Más. Así el cuerpo del modal queda para
                        tomar pedidos, que es lo que más se hace. */}
                    {floor.key === 'listo' && canServe && (
                        <Button className="w-full h-12" onClick={() => deliver(actionAccountId)} data-testid="mesa-sheet-entregar">Entregar</Button>
                    )}
                    {/* Un solo lugar para cerrar: la etiqueta cambia
                        con el momento de la visita en vez de sumar un
                        botón por cada paso del cobro. */}
                    {closeable ? (
                        <Button variant="outline" className="w-full h-12" onClick={() => closeAttention(actionOrder)} disabled={closing === actionOrder?.id} data-testid={`servicio-cerrar-sheet-${t.number}`}>
                            {closing === actionOrder?.id ? 'Cerrando…' : 'Finalizar mesa'}
                        </Button>
                    ) : billRequested ? (
                        <Button disabled variant="outline" className="w-full h-12" data-testid="mesa-sheet-cuenta-solicitada">
                            Cuenta solicitada
                        </Button>
                    ) : (
                        ['listo', 'entregado'].includes(actionOrder?.status) && canTake && (
                            <Button variant="outline" className="w-full h-12" onClick={() => requestBill(actionOrder)} data-testid="mesa-sheet-solicitar-cuenta">
                                Solicitar cuenta
                            </Button>
                        )
                    )}
                    <MoreActions
                        testId="mesa-sheet-mas"
                        actions={[
                            {
                                key: 'ver-pedido',
                                label: floor.key === 'listo' ? 'Ver pedido' : 'Abrir pedido',
                                testId: 'mesa-sheet-ver-pedido',
                                disabled: !actionAccountId,
                                onSelect: () => { closeSheet(); navigate(`/pedidos/${actionAccountId}`); },
                            },
                            ...(canTake && actionOrder && (actionOrder.items || []).filter((i) => i.status !== 'cancelado').length >= 2
                                ? [{ group: 'Dividir la cuenta' }, ...[2, 3, 4].map((n) => ({
                                    key: `dividir-${n}`,
                                    label: `En ${n} cuentas`,
                                    testId: `mesa-sheet-dividir-${n}`,
                                    onSelect: () => splitAccount(n),
                                }))]
                                : []),
                            ...(canTake ? [{
                                key: 'mover-pedido',
                                label: 'Mover pedido a otra mesa',
                                icon: MoveRight,
                                testId: 'mesa-sheet-mover-pedido',
                                onSelect: () => openTransfer(t),
                            }] : []),
                            ...(accounts.length > 1 && canTake ? [
                                {
                                    key: 'mover-cuenta',
                                    label: 'Mover esta cuenta a otra mesa',
                                    icon: MoveRight,
                                    testId: 'mesa-sheet-mover-cuenta',
                                    onSelect: () => setMoveAccountId(actionAccountId),
                                },
                                {
                                    key: 'fusionar-cuentas',
                                    label: 'Fusionar cuentas',
                                    icon: Link2,
                                    testId: 'mesa-sheet-fusionar-cuentas',
                                    onSelect: mergeAccounts,
                                },
                            ] : []),
                        ]}
                    />
                </>
            ) : t.status === 'pagada' ? (
                <Button className="w-full h-12" variant="outline" onClick={() => releaseTable(t)} disabled={!canTake} data-testid="mesa-sheet-liberar">
                    Liberar mesa
                </Button>
            ) : null}
        </div>
    );
}
